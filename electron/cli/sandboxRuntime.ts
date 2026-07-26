import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

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
      allowLocalBinding: false
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
    paths.push(path.join(home, ".config", "opencode"));
  }
  if (adapter.includes("kimi")) {
    paths.push(path.join(home, ".kimi"), path.join(home, ".config", "kimi"));
  }
  if (adapter.includes("qoder")) {
    paths.push(path.join(home, ".qoder"), path.join(home, ".config", "qoder"));
  }
  if (adapter.includes("codebuddy")) {
    paths.push(
      path.join(home, ".codebuddy"),
      path.join(home, ".config", "codebuddy")
    );
  }
  return existing(paths);
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

  const binary = resolveBinary(input.bin, input.env);
  const workspaceRoot = input.workspaceRoot ?? input.cwd;
  const configPaths = adapterConfigPaths(input.adapter);
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
    ...binaryPaths,
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
  const command = [binary ?? input.bin, ...input.args]
    .map(quotePosix)
    .join(" ");
  const wrapped = await SandboxManager.wrapWithSandboxArgv(
    command,
    undefined,
    {
      filesystem: {
        denyRead,
        allowRead: allowedRead,
        allowWrite: existing([workspaceRoot, ...configPaths]),
        denyWrite: []
      },
      git: { safeDirectories: [workspaceRoot] }
    },
    undefined,
    input.cwd
  );
  return {
    bin: wrapped.argv[0]!,
    args: wrapped.argv.slice(1),
    // The sandbox supplies proxy/socket variables that must override inherited
    // host values. Reversing this order could silently bypass network routing.
    env: { ...input.env, ...wrapped.env }
  };
}

export function cleanupSandboxCommand(): void {
  SandboxManager.cleanupAfterCommand();
}
