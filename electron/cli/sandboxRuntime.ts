import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SandboxManager,
  type SandboxRuntimeConfig
} from "@anthropic-ai/sandbox-runtime";

import { getCallerUserId, isCallerAdmin } from "./callerContext.js";
import { getDataDir } from "./db.js";
import { getUserRoots, listUsers } from "./users.js";

export interface SandboxedSpawn {
  bin: string;
  args: string[];
  env: Record<string, string | undefined>;
}

const PUBLIC_AGENT_DOMAINS = [
  "api.openai.com",
  "*.openai.com",
  "api.anthropic.com",
  "*.anthropic.com",
  "*.claude.ai",
  "github.com",
  "*.github.com",
  "npmjs.org",
  "*.npmjs.org",
  "pypi.org",
  "*.pypi.org",
  "crates.io",
  "*.crates.io"
];

let initialization: Promise<void> | null = null;
let ipv6ProxyBridge: net.Server | null = null;
let ipv6ProxyBridgePort: number | null = null;
let ipv6ProxyBridgeInitialization: Promise<void> | null = null;

export function shouldSandboxCurrentCaller(): boolean {
  return Boolean(getCallerUserId()) && !isCallerAdmin();
}

export function sandboxWorkingDirectory(cwd: string | undefined): string {
  if (cwd) return cwd;
  const userId = getCallerUserId();
  if (!userId) throw new Error("remote_sandbox_missing_owner");
  const scratch = path.join(getDataDir(), "remote-workspaces", userId, "scratch");
  fs.mkdirSync(scratch, { recursive: true, mode: 0o700 });
  return scratch;
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function publicNetworkDestination(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/\.$/, "");
  if (
    !normalized ||
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  ) {
    return false;
  }
  const ipKind = net.isIP(normalized);
  if (ipKind === 4) return !isPrivateIpv4(normalized);
  if (ipKind === 6) {
    const compact = normalized.replace(/^\[|\]$/g, "");
    return !(
      compact === "::" ||
      compact === "::1" ||
      compact.startsWith("fe8") ||
      compact.startsWith("fe9") ||
      compact.startsWith("fea") ||
      compact.startsWith("feb") ||
      compact.startsWith("fc") ||
      compact.startsWith("fd")
    );
  }
  return true;
}

function baseConfig(): SandboxRuntimeConfig {
  return {
    network: {
      allowedDomains: PUBLIC_AGENT_DOMAINS,
      deniedDomains: [
        "localhost",
        "127.0.0.1",
        "0.0.0.0",
        "169.254.169.254"
      ],
      strictAllowlist: false,
      allowUnixSockets: [],
      allowAllUnixSockets: false,
      // Some ACP clients (notably CodeBuddy) start an in-process loopback
      // service. SRT still blocks LAN/private-address egress; this only permits
      // bind/connect on 127.0.0.1 and ::1.
      allowLocalBinding: true
    },
    filesystem: {
      denyRead: [],
      allowRead: [],
      allowWrite: [],
      denyWrite: [],
      allowGitConfig: false
    },
    allowAppleEvents: false
  };
}

async function ensureInitialized(): Promise<void> {
  if (!initialization) {
    initialization = SandboxManager.initialize(
      baseConfig(),
      async ({ host }) => publicNetworkDestination(host)
    ).catch((error) => {
      initialization = null;
      throw new Error(
        `remote_sandbox_unavailable: ${
          (error as Error)?.message || String(error)
        }`
      );
    });
  }
  await initialization;
}

// Qoder's Bun client resolves localhost to ::1, while Grok's native client
// cannot resolve SRT's localhost hostname inside Seatbelt. SRT listens on IPv4
// loopback, so forward the same port from ::1. Both clients still traverse
// SRT's authentication and network policy.
async function ensureIpv6ProxyBridge(adapter: string): Promise<boolean> {
  if (
    process.platform !== "darwin" ||
    (!adapter.includes("qoder") && !adapter.includes("grok"))
  ) {
    return false;
  }

  const proxyPort = SandboxManager.getProxyPort();
  if (!proxyPort) {
    return false;
  }
  if (ipv6ProxyBridge?.listening && ipv6ProxyBridgePort === proxyPort) {
    return true;
  }
  if (ipv6ProxyBridgeInitialization) {
    await ipv6ProxyBridgeInitialization;
    return ipv6ProxyBridge?.listening === true;
  }

  ipv6ProxyBridgeInitialization = (async () => {
    if (ipv6ProxyBridge) {
      await new Promise<void>((resolve) => {
        ipv6ProxyBridge?.close(() => resolve());
      });
      ipv6ProxyBridge = null;
      ipv6ProxyBridgePort = null;
    }

    const bridge = net.createServer((client) => {
      const upstream = net.connect(proxyPort, "127.0.0.1");
      client.on("error", () => upstream.destroy());
      upstream.on("error", () => client.destroy());
      client.pipe(upstream);
      upstream.pipe(client);
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        bridge.close();
        reject(
          new Error(`remote_sandbox_ipv6_proxy_unavailable: ${error.message}`)
        );
      };
      bridge.once("error", onError);
      bridge.listen(
        { host: "::1", port: proxyPort, ipv6Only: true },
        () => {
          bridge.off("error", onError);
          resolve();
        }
      );
    });
    bridge.on("error", () => {
      // Connection-level failures are surfaced by the Agent. Keep the host app
      // alive so a later agent run can report an actionable network error.
    });
    bridge.unref();
    ipv6ProxyBridge = bridge;
    ipv6ProxyBridgePort = proxyPort;
  })().finally(() => {
    ipv6ProxyBridgeInitialization = null;
  });

  await ipv6ProxyBridgeInitialization;
  return true;
}

function existing(paths: string[]): string[] {
  return [...new Set(paths.map((entry) => path.resolve(entry)))].filter((entry) => {
    try {
      return fs.existsSync(entry);
    } catch {
      return false;
    }
  });
}

function resolveBinary(binary: string, env: Record<string, string | undefined>): string | null {
  if (path.isAbsolute(binary)) {
    try {
      return fs.realpathSync.native(binary);
    } catch {
      return binary;
    }
  }
  const pathValue = env.PATH ?? process.env.PATH ?? "";
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, binary);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.realpathSync.native(candidate);
    } catch {
      // Continue searching PATH.
    }
  }
  return null;
}

function adapterConfigPaths(adapter: string): string[] {
  const home = os.homedir();
  const paths = [
    path.join(home, ".config", "freebuddy"),
    path.join(home, ".freebuddy")
  ];
  if (adapter.includes("codex")) {
    paths.push(path.join(home, ".codex"), path.join(home, ".config", "codex"));
  }
  if (adapter.includes("claude")) {
    paths.push(
      path.join(home, ".claude"),
      path.join(home, ".claude.json"),
      path.join(home, ".config", "claude")
    );
  }
  if (adapter.includes("cursor")) {
    paths.push(path.join(home, ".cursor"), path.join(home, ".config", "cursor"));
  }
  if (adapter.includes("opencode")) {
    paths.push(
      path.join(home, ".config", "opencode"),
      path.join(home, ".local", "share", "opencode"),
      path.join(home, ".local", "state", "opencode"),
      path.join(home, ".cache", "opencode")
    );
  }
  if (adapter.includes("kimi")) {
    paths.push(
      path.join(home, ".kimi-code"),
      path.join(home, ".kimi"),
      path.join(home, ".config", "kimi")
    );
  }
  if (adapter.includes("qoder")) {
    paths.push(path.join(home, ".qoder"), path.join(home, ".config", "qoder"));
  }
  if (adapter.includes("codebuddy")) {
    paths.push(
      path.join(home, ".codebuddy"),
      path.join(home, ".config", "codebuddy"),
      path.join(
        home,
        "Library",
        "Application Support",
        "CodeBuddyExtension",
        "Data",
        "Public",
        "auth"
      )
    );
  }
  if (adapter.includes("grok")) {
    paths.push(path.join(home, ".grok"), path.join(home, ".config", "grok"));
  }
  return existing(paths);
}

function qoderProjectIdentifier(workspaceRoot: string): string {
  const sanitized = workspaceRoot.replace(/[^a-zA-Z0-9]/g, "-");
  if (sanitized.length <= 200) return sanitized;

  // Qoder 1.1.x uses this DJB2-style signed 32-bit hash when its sanitized
  // project path exceeds 200 characters. Mirror it so Seatbelt/bubblewrap can
  // permit only the current remote workspace's output subtree.
  let hash = 5381;
  for (let index = 0; index < workspaceRoot.length; index += 1) {
    hash = (hash * 33) ^ workspaceRoot.charCodeAt(index);
  }
  return `${sanitized.slice(0, 200)}-${Math.abs(hash).toString(36)}`;
}

function qoderShellOutputPath(
  adapter: string,
  workspaceRoot: string
): string | null {
  if (!adapter.includes("qoder") || process.platform === "win32") return null;

  // Qoder resolves /tmp directly instead of honoring TMPDIR for persisted Bash
  // output. Its next path component is derived from the workspace, so grant
  // only that component rather than the shared qoder-cli-<uid> root.
  let tempRoot = "/tmp";
  try {
    tempRoot = fs.realpathSync.native(tempRoot);
  } catch {
    // Match Qoder's fallback when /tmp cannot be resolved.
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const sharedRoot = path.join(tempRoot, `qoder-cli-${uid}`);
  const isolatedRoot = path.join(
    sharedRoot,
    qoderProjectIdentifier(workspaceRoot)
  );

  fs.mkdirSync(sharedRoot, { recursive: true, mode: 0o700 });
  const sharedStat = fs.lstatSync(sharedRoot);
  if (
    !sharedStat.isDirectory() ||
    sharedStat.isSymbolicLink() ||
    (typeof process.getuid === "function" && sharedStat.uid !== process.getuid())
  ) {
    throw new Error("remote_sandbox_unsafe_qoder_temp_root");
  }

  fs.mkdirSync(isolatedRoot, { recursive: true, mode: 0o700 });
  const isolatedStat = fs.lstatSync(isolatedRoot);
  if (
    !isolatedStat.isDirectory() ||
    isolatedStat.isSymbolicLink() ||
    (typeof process.getuid === "function" &&
      isolatedStat.uid !== process.getuid())
  ) {
    throw new Error("remote_sandbox_unsafe_qoder_workspace_temp");
  }
  fs.chmodSync(isolatedRoot, 0o700);
  return isolatedRoot;
}

function adapterSandboxEnvironment(
  adapter: string,
  workspaceRoot: string
): {
  env: Record<string, string>;
  readWritePaths: string[];
} {
  const userId = getCallerUserId();
  if (!userId) {
    return { env: {}, readWritePaths: [] };
  }

  const sandboxHome = path.join(
    getDataDir(),
    "remote-workspaces",
    userId,
    "sandbox-home"
  );
  fs.mkdirSync(sandboxHome, { recursive: true, mode: 0o700 });
  const sandboxTmp = path.join(sandboxHome, "tmp");
  fs.mkdirSync(sandboxTmp, { recursive: true, mode: 0o700 });
  const qoderConfig = path.join(os.homedir(), ".qoder");
  const qoderOutput = qoderShellOutputPath(adapter, workspaceRoot);

  return {
    env: {
      // Keep agent subprocesses and their shell tools out of the host user's
      // shared macOS/Linux temporary directory.
      TMPDIR: sandboxTmp,
      TMP: sandboxTmp,
      TEMP: sandboxTmp,
      // Claude's native macOS binary intentionally defaults to /tmp unless
      // this dedicated override is present.
      ...(adapter.includes("claude")
        ? { CLAUDE_CODE_TMPDIR: sandboxTmp }
        : {}),
      // Qoder's Bun runtime resolves HOME during startup. Point it at a
      // per-WebUI-user directory instead of exposing the host user's home.
      ...(adapter.includes("qoder") ? { HOME: sandboxHome } : {}),
      // Keep using the installed Qoder account and settings. This is the
      // documented environment equivalent of Qoder's --config-dir option.
      ...(adapter.includes("qoder") && fs.existsSync(qoderConfig)
        ? { QODER_CONFIG_DIR: qoderConfig }
        : {})
    },
    readWritePaths: [sandboxHome, ...(qoderOutput ? [qoderOutput] : [])]
  };
}

function applicationRuntimeReadPaths(): string[] {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  return existing([
    // ACP skill/context MCP servers run through Electron-as-Node. Grant the
    // executable bundle and FreeBuddy's compiled MCP scripts, without exposing
    // the source checkout or any additional host-user directories.
    process.execPath,
    path.dirname(process.execPath),
    path.dirname(path.dirname(process.execPath)),
    path.resolve(moduleDirectory, "..")
  ]);
}

function allAssignedRepositoryRoots(): string[] {
  return existing(listUsers().flatMap((user) => getUserRoots(user.id)));
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export async function prepareSandboxedSpawn(input: {
  adapter: string;
  bin: string;
  args: string[];
  cwd: string;
  workspaceRoot?: string;
  env: Record<string, string | undefined>;
  extraReadPaths?: string[];
}): Promise<SandboxedSpawn> {
  if (process.platform === "win32") {
    throw new Error(
      "remote_sandbox_unavailable: Windows lightweight sandbox setup is not included in this first version"
    );
  }
  await ensureInitialized();
  const useIpv6Proxy = await ensureIpv6ProxyBridge(input.adapter);

  const binary = resolveBinary(input.bin, input.env);
  const workspaceRoot = input.workspaceRoot ?? input.cwd;
  const configPaths = adapterConfigPaths(input.adapter);
  const adapterSandbox = adapterSandboxEnvironment(input.adapter, workspaceRoot);
  const binaryPaths = binary
    ? existing([
        binary,
        path.dirname(binary),
        path.dirname(path.dirname(binary))
      ])
    : [];
  const allowedRead = existing([
    workspaceRoot,
    ...configPaths,
    ...adapterSandbox.readWritePaths,
    ...binaryPaths,
    ...applicationRuntimeReadPaths(),
    ...(input.extraReadPaths ?? [])
  ]);
  const denyRead = existing([
    process.platform === "darwin" ? "/Users" : "/home",
    ...allAssignedRepositoryRoots()
  ]);
  // Resolve PATH-based launchers before entering the sandbox. User-local bin
  // directories (for example ~/.local/bin) are intentionally hidden from
  // remote callers, while the launcher target itself is explicitly allowed.
  // Keeping the original command name here would make the sandbox shell try
  // PATH lookup after isolation and fail with "command not found".
  // SRT intentionally supplies its own TMPDIR in the outer wrapper. Apply the
  // per-user adapter environment again on the inner command so Agent tools see
  // the isolated directory instead of SRT's shared compatibility directory.
  const commandEnvironment = Object.entries(adapterSandbox.env).map(
    ([key, value]) => `${key}=${quotePosix(value)}`
  );
  const command = [
    ...commandEnvironment,
    ...[binary ?? input.bin, ...input.args].map(quotePosix)
  ].join(" ");
  const wrapped = await SandboxManager.wrapWithSandboxArgv(
    command,
    undefined,
    {
      filesystem: {
        denyRead,
        allowRead: allowedRead,
        allowWrite: existing([
          workspaceRoot,
          ...configPaths,
          ...adapterSandbox.readWritePaths
        ]),
        denyWrite: []
      },
      git: { safeDirectories: [workspaceRoot] }
    },
    undefined,
    input.cwd
  );
  const wrappedArgv = wrapped.argv.map((entry) => {
    if (useIpv6Proxy) {
      return entry.replaceAll("@localhost:", "@[::1]:");
    }
    // Several native Agent HTTP clients (CodeBuddy included) perform an
    // explicit DNS lookup for the SRT proxy hostname from inside Seatbelt,
    // where resolving localhost is denied. The proxy itself listens on IPv4
    // loopback, so other adapters use its numeric address.
    return entry.replaceAll("@localhost:", "@127.0.0.1:");
  });
  return {
    bin: wrappedArgv[0]!,
    args: wrappedArgv.slice(1),
    // The sandbox supplies proxy/socket variables that must override inherited
    // host values. Adapter overrides are limited to the isolated HOME and
    // explicit config root, so applying them last cannot bypass network routing.
    env: { ...input.env, ...wrapped.env, ...adapterSandbox.env }
  };
}

export function cleanupSandboxCommand(): void {
  SandboxManager.cleanupAfterCommand();
}
