import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getWindowsSandboxUserStatusAsync,
  grantWindowsAcl,
  resolveSrtWin,
  revokeWindowsAcl,
  SandboxManager,
  VENDORED_SRT_WIN_EXE,
  WindowsSandboxError,
  type WindowsBinShell,
  type SandboxRuntimeConfig
} from "@anthropic-ai/sandbox-runtime";

import { getCallerUserId, isCallerAdmin } from "./callerContext.js";
import { getDataDir } from "./db.js";
import { getUserRoots, listUsers } from "./users.js";
import { resolveWindowsShellCommand } from "./windowsEnv.js";

export interface SandboxedSpawn {
  bin: string;
  args: string[];
  env: Record<string, string | undefined>;
  stdinPath?: string;
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
let windowsInitializationConfig: SandboxRuntimeConfig | null = null;
let windowsActiveCommands = 0;
const windowsBinaryAliasDirectories = new Set<string>();
const windowsStdinBridgePaths = new Set<string>();
let windowsHelperAccessGranted = false;
let windowsHelperSandboxSid: string | null = null;
let windowsReset: Promise<void> | null = null;
let windowsPrepareQueue: Promise<void> = Promise.resolve();
let ipv6ProxyBridge: net.Server | null = null;
let ipv6ProxyBridgePort: number | null = null;
let ipv6ProxyBridgeInitialization: Promise<void> | null = null;

async function withWindowsPrepareLock<T>(
  action: () => Promise<T>
): Promise<T> {
  const previous = windowsPrepareQueue;
  let release!: () => void;
  windowsPrepareQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

function asarUnpackedPath(file: string): string {
  return file.replace(
    /([/\\])app\.asar([/\\])/,
    "$1app.asar.unpacked$2"
  );
}

function windowsSrtWinPath(): string {
  return asarUnpackedPath(VENDORED_SRT_WIN_EXE);
}

async function ensureWindowsHelperAccess(): Promise<void> {
  if (windowsHelperAccessGranted) return;

  const srtWin = resolveSrtWin({ path: windowsSrtWinPath() });
  const status = await getWindowsSandboxUserStatusAsync({ srtWin });
  if (!status.provisioned || !status.sid) {
    throw new WindowsSandboxError(
      "not_provisioned",
      "Windows sandbox user is not provisioned"
    );
  }

  grantWindowsAcl({
    read: [path.dirname(srtWin.exe), srtWin.exe],
    write: [],
    sandboxUserSid: status.sid,
    srtWin
  });
  windowsHelperSandboxSid = status.sid;
  windowsHelperAccessGranted = true;
}

function revokeWindowsHelperAccess(): void {
  if (!windowsHelperAccessGranted || !windowsHelperSandboxSid) return;

  const srtWin = resolveSrtWin({ path: windowsSrtWinPath() });
  try {
    revokeWindowsAcl({
      sandboxUserSid: windowsHelperSandboxSid,
      srtWin
    });
  } catch (error) {
    console.error(
      `[sandbox] Windows helper ACL cleanup failed: ${
        (error as Error)?.message || String(error)
      }`
    );
  } finally {
    windowsHelperAccessGranted = false;
    windowsHelperSandboxSid = null;
  }
}

function startWindowsReset(): Promise<void> {
  if (windowsReset) return windowsReset;

  windowsReset = SandboxManager.reset()
    .catch((error) => {
      console.error(
        `[sandbox] Windows cleanup failed: ${(error as Error)?.message || String(error)}`
      );
    })
    .finally(() => {
      cleanupWindowsBinaryAliases();
      cleanupWindowsStdinBridges();
      revokeWindowsHelperAccess();
      initialization = null;
      windowsInitializationConfig = null;
      windowsReset = null;
    });
  return windowsReset;
}

function cleanupWindowsStdinBridges(): void {
  for (const bridgePath of windowsStdinBridgePaths) {
    try {
      fs.rmSync(bridgePath, { force: true });
    } catch (error) {
      console.error(
        `[sandbox] Windows stdin bridge cleanup failed: ${(error as Error)?.message || String(error)}`
      );
    } finally {
      windowsStdinBridgePaths.delete(bridgePath);
    }
  }
}

function cleanupWindowsBinaryAliases(): void {
  for (const aliasDirectory of windowsBinaryAliasDirectories) {
    try {
      if (fs.lstatSync(aliasDirectory).isSymbolicLink()) {
        fs.rmdirSync(aliasDirectory);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(
          `[sandbox] Windows Agent alias cleanup failed: ${
            (error as Error)?.message || String(error)
          }`
        );
      }
    } finally {
      windowsBinaryAliasDirectories.delete(aliasDirectory);
    }
  }
}

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

function baseConfig(
  filesystem: SandboxRuntimeConfig["filesystem"] = {
    denyRead: [],
    allowRead: [],
    allowWrite: [],
    denyWrite: [],
    allowGitConfig: false
  }
): SandboxRuntimeConfig {
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
    filesystem,
    ...(process.platform === "win32"
      ? {
          windows: {
            srtWin: { path: windowsSrtWinPath() }
          }
        }
      : {}),
    allowAppleEvents: false
  };
}

function sandboxUnavailableMessage(error: unknown): string {
  if (
    process.platform === "win32" &&
    error instanceof WindowsSandboxError &&
    error.code === "not_provisioned"
  ) {
    return "Windows sandbox is not installed. On the FreeBuddy host, run `npx @anthropic-ai/sandbox-runtime windows-install` once and approve the UAC prompt.";
  }
  return (error as Error)?.message || String(error);
}

async function ensureInitialized(
  config: SandboxRuntimeConfig = baseConfig()
): Promise<void> {
  if (!initialization) {
    initialization = SandboxManager.initialize(
      config,
      async ({ host }) => publicNetworkDestination(host)
    ).catch((error) => {
      initialization = null;
      throw new Error(`remote_sandbox_unavailable: ${sandboxUnavailableMessage(error)}`);
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

function isWithinPath(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

interface WindowsBinaryAlias {
  binary: string;
  directory: string;
  readPath: string;
}

function ensureWindowsBinaryAlias(
  binary: string,
  adapter: string
): WindowsBinaryAlias | null {
  if (process.platform !== "win32" || !isWithinPath(os.homedir(), binary)) {
    return null;
  }

  const targetDirectory = path.dirname(binary);
  const aliasRoot = path.join(os.homedir(), ".freebuddy-agent-links");
  fs.mkdirSync(aliasRoot, { recursive: true, mode: 0o700 });
  const rootStat = fs.lstatSync(aliasRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("remote_sandbox_unsafe_windows_agent_alias_root");
  }

  const label =
    adapter.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40) || "agent";
  const digest = createHash("sha256")
    .update(targetDirectory.toLowerCase())
    .digest("hex")
    .slice(0, 16);
  const aliasDirectory = path.join(aliasRoot, `${label}-${digest}`);

  try {
    const aliasStat = fs.lstatSync(aliasDirectory);
    if (!aliasStat.isSymbolicLink()) {
      throw new Error("remote_sandbox_unsafe_windows_agent_alias");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    fs.symlinkSync(targetDirectory, aliasDirectory, "junction");
  }

  const resolvedTarget = fs.realpathSync.native(aliasDirectory);
  if (
    path.resolve(resolvedTarget).toLowerCase() !==
    path.resolve(targetDirectory).toLowerCase()
  ) {
    throw new Error("remote_sandbox_unsafe_windows_agent_alias");
  }

  windowsBinaryAliasDirectories.add(aliasDirectory);
  const aliasedBinary = path.join(aliasDirectory, path.basename(binary));
  if (!fs.existsSync(aliasedBinary)) {
    throw new Error("remote_sandbox_missing_windows_agent_alias");
  }
  return {
    binary: aliasedBinary,
    directory: aliasDirectory,
    readPath: aliasRoot
  };
}

function windowsNodeLauncherEntry(binary: string): string | null {
  if (![".cmd", ".bat"].includes(path.extname(binary).toLowerCase())) {
    return null;
  }
  let source: string;
  try {
    source = fs.readFileSync(binary, "utf8").slice(0, 64 * 1024);
  } catch {
    return null;
  }
  const match =
    source.match(/"%dp0%\\([^"\r\n]+)"\s+%\*/i) ??
    source.match(/"%~dp0([^"\r\n]+)"\s*(?:%\*|$)/im);
  if (!match?.[1]) return null;

  const entry = path.resolve(path.dirname(binary), match[1]);
  if (!isWithinPath(path.dirname(binary), entry) || !fs.existsSync(entry)) {
    return null;
  }
  return entry;
}

async function resolveBinary(
  binary: string,
  env: Record<string, string | undefined>
): Promise<string | null> {
  if (path.isAbsolute(binary)) {
    try {
      return fs.realpathSync.native(binary);
    } catch {
      return binary;
    }
  }
  if (process.platform === "win32") {
    return (await resolveWindowsShellCommand(binary, env)) ?? null;
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

function prepareGrokSandboxHome(
  adapter: string,
  sandboxHome: string,
  hostHome: string
): string | null {
  if (process.platform !== "win32" || !adapter.includes("grok")) return null;

  const sourceRoot = path.join(hostHome, ".grok");
  const destinationRoot = path.join(sandboxHome, ".grok");
  fs.mkdirSync(destinationRoot, { recursive: true, mode: 0o700 });
  const destinationRootStat = fs.lstatSync(destinationRoot);
  if (
    !destinationRootStat.isDirectory() ||
    destinationRootStat.isSymbolicLink()
  ) {
    throw new Error("remote_sandbox_unsafe_grok_home");
  }

  for (const name of ["auth.json", "agent_id", "config.toml", "models_cache.json"]) {
    const source = path.join(sourceRoot, name);
    const destination = path.join(destinationRoot, name);
    let sourceStat: fs.Stats;
    try {
      sourceStat = fs.lstatSync(source);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) continue;

    try {
      const destinationStat = fs.lstatSync(destination);
      if (!destinationStat.isFile() || destinationStat.isSymbolicLink()) {
        throw new Error("remote_sandbox_unsafe_grok_config");
      }
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, 0o600);
  }

  return destinationRoot;
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
  const hostHome = os.homedir();
  const qoderConfig = path.join(hostHome, ".qoder");
  const grokHome = prepareGrokSandboxHome(adapter, sandboxHome, hostHome);
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
      // srt-win runs under a dedicated local account. Point agents at the
      // host profile so their existing authentication/config discovery still
      // works; NTFS grants below expose only the adapter-specific paths.
      ...(process.platform === "win32" && !adapter.includes("qoder")
        ? {
            HOME: hostHome,
            USERPROFILE: hostHome,
            ...(adapter.includes("codex")
              ? { CODEX_HOME: path.join(hostHome, ".codex") }
              : {})
          }
        : {}),
      // Qoder's Bun runtime resolves HOME during startup. Point it at a
      // per-WebUI-user directory instead of exposing the host user's home.
      ...(adapter.includes("qoder") ? { HOME: sandboxHome } : {}),
      // Keep using the installed Qoder account and settings. This is the
      // documented environment equivalent of Qoder's --config-dir option.
      ...(adapter.includes("qoder") && fs.existsSync(qoderConfig)
        ? { QODER_CONFIG_DIR: qoderConfig }
        : {}),
      // Grok takes an exclusive lock while loading and refreshing auth. Give
      // each WebUI user a writable copy instead of exposing host config writes.
      ...(grokHome ? { GROK_HOME: grokHome } : {})
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

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}


const WINDOWS_NODE_RUNNER = [
  "const p=JSON.parse(Buffer.from(process.argv[1],'base64url'))",
  "Object.assign(process.env,p.env)",
  "const fs=(await import('node:fs')).default",
  "const path=(await import('node:path')).default",
  "const{PassThrough}=await import('node:stream')",
  "const bridgedStdin=new PassThrough()",
  "Object.defineProperty(process,'stdin',{value:bridgedStdin})",
  "let stdinOffset=0",
  "const pumpStdin=()=>{try{const data=fs.readFileSync(p.stdin);if(data.length<stdinOffset)stdinOffset=0;if(data.length>stdinOffset){bridgedStdin.write(data.subarray(stdinOffset));stdinOffset=data.length}}catch{}}",
  "pumpStdin()",
  "setInterval(pumpStdin,10).unref()",
  "const root=path.resolve(p.workspace)",
  "const original=fs.realpathSync",
  "const originalNative=fs.realpathSync.native",
  "const preserve=(candidate,options,realpath)=>typeof candidate==='string'&&(path.resolve(candidate).toLowerCase()===root.toLowerCase()||path.resolve(candidate).toLowerCase().startsWith(root.toLowerCase()+path.sep))?(options==='buffer'||options?.encoding==='buffer'?Buffer.from(path.resolve(candidate)):path.resolve(candidate)):realpath(candidate,options)",
  "fs.realpathSync=(candidate,options)=>preserve(candidate,options,original)",
  "fs.realpathSync.native=(candidate,options)=>preserve(candidate,options,originalNative)",
  "const{syncBuiltinESMExports}=await import('node:module')",
  "syncBuiltinESMExports()",
  "if(p.entry){",
  "process.argv=[process.execPath,p.entry,...p.args]",
  "const{pathToFileURL}=await import('node:url')",
  "await import(pathToFileURL(p.entry).href)",
  "}else{",
  "const{spawn}=await import('node:child_process')",
  "const child=spawn(p.bin,p.args,{stdio:['pipe','inherit','inherit'],env:process.env})",
  "bridgedStdin.pipe(child.stdin)",
  "child.stdin.on('error',()=>{})",
  "const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})",
  "process.exitCode=code??1",
  "}"
].join(";");


function windowsPowerShell(env: Record<string, string | undefined>): string {
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
  return path.win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
}

const WINDOWS_SANDBOX_PROXY_ENV = new Set([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "CURL_CA_BUNDLE",
  "GIT_SSL_CAINFO",
  "CARGO_HTTP_CAINFO"
]);

function windowsCommandEnvironment(
  env: Record<string, string | undefined>,
  adapterEnv: Record<string, string>
): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value == null || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const upper = key.toUpperCase();
    if (WINDOWS_SANDBOX_PROXY_ENV.has(upper)) continue;
    if (
      value !== process.env[key] ||
      /(API_KEY|TOKEN|SECRET|_MODEL|BASE_URL|CONFIG)/i.test(key)
    ) {
      forwarded[key] = value;
    }
  }
  return { ...forwarded, ...adapterEnv };
}

function windowsNodeOptions(current: string | undefined): string {
  const options =
    current
      ?.split(/\s+/)
      .filter(Boolean) ?? [];
  for (const required of ["--preserve-symlinks", "--preserve-symlinks-main"]) {
    if (!options.includes(required)) options.push(required);
  }
  return options.join(" ");
}

function windowsConfigCovers(
  current: SandboxRuntimeConfig,
  required: SandboxRuntimeConfig
): boolean {
  const includesAll = (available: string[], needed: string[]) => {
    const keys = new Set(available.map((entry) => path.resolve(entry).toLowerCase()));
    return needed.every((entry) => keys.has(path.resolve(entry).toLowerCase()));
  };
  return (
    includesAll(current.filesystem.allowRead ?? [], required.filesystem.allowRead ?? []) &&
    includesAll(current.filesystem.allowWrite, required.filesystem.allowWrite) &&
    includesAll(current.filesystem.denyRead, required.filesystem.denyRead) &&
    includesAll(current.filesystem.denyWrite, required.filesystem.denyWrite)
  );
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
  const binary = await resolveBinary(input.bin, input.env);
  const binaryAlias = binary
    ? ensureWindowsBinaryAlias(binary, input.adapter)
    : null;
  const nodeLauncherEntry = binary
    ? windowsNodeLauncherEntry(binary)
    : null;
  const nodeLauncherBinary = nodeLauncherEntry
    ? await resolveBinary("node", input.env)
    : null;
  const aliasedNodeEntry =
    nodeLauncherEntry && binaryAlias
      ? path.join(
          binaryAlias.directory,
          path.relative(path.dirname(binary!), nodeLauncherEntry)
        )
      : null;
  const windowsLaunchBinary =
    aliasedNodeEntry && nodeLauncherBinary
      ? nodeLauncherBinary
      : binaryAlias?.binary ?? binary ?? input.bin;
  const windowsLaunchArgs =
    aliasedNodeEntry && nodeLauncherBinary
      ? [aliasedNodeEntry, ...input.args]
      : input.args;
  const windowsBridgeNodeBinary =
    process.platform === "win32" && input.adapter.includes("acp")
      ? nodeLauncherBinary ?? await resolveBinary("node", input.env)
      : null;
  const workspaceRoot = input.workspaceRoot ?? input.cwd;
  const configPaths = adapterConfigPaths(input.adapter);
  const adapterSandbox = adapterSandboxEnvironment(input.adapter, workspaceRoot);
  const windowsStdinPath =
    process.platform === "win32" && windowsBridgeNodeBinary
      ? path.join(
          adapterSandbox.readWritePaths[0]!,
          `.stdin-${randomUUID()}.jsonl`
        )
      : null;
  if (windowsStdinPath) fs.writeFileSync(windowsStdinPath, "", { mode: 0o600 });
  if (windowsStdinPath) windowsStdinBridgePaths.add(windowsStdinPath);
  const binaryPaths = binary
    ? existing(
        process.platform === "win32"
          ? isWithinPath(os.homedir(), binary)
            ? [binary, path.dirname(binary)]
            : []
          : [
              binary,
              path.dirname(binary),
              path.dirname(path.dirname(binary))
            ]
      )
    : [];
  const allowedRead = existing([
    workspaceRoot,
    ...configPaths,
    ...adapterSandbox.readWritePaths,
    ...binaryPaths,
    ...(binaryAlias ? [binaryAlias.readPath] : []),
    ...(process.platform === "win32" ? [] : applicationRuntimeReadPaths()),
    ...(input.extraReadPaths ?? [])
  ]);
  const denyRead = existing([
    process.platform === "darwin" ? "/Users" : "/home",
    ...allAssignedRepositoryRoots()
  ]);
  const allowWrite = existing([
    workspaceRoot,
    ...configPaths,
    ...adapterSandbox.readWritePaths
  ]);

  if (process.platform === "win32") {
    const requiredConfig = baseConfig({
      denyRead,
      allowRead: allowedRead,
      allowWrite,
      denyWrite: [],
      allowGitConfig: false
    });
    return withWindowsPrepareLock(async () => {
      if (windowsReset) await windowsReset;
      if (!initialization) {
        try {
          await ensureWindowsHelperAccess();
          await ensureInitialized(requiredConfig);
          windowsInitializationConfig = requiredConfig;
        } catch (error) {
          cleanupWindowsBinaryAliases();
          revokeWindowsHelperAccess();
          cleanupWindowsStdinBridges();
          if ((error as Error)?.message?.startsWith("remote_sandbox_")) {
            throw error;
          }
          throw new Error(
            `remote_sandbox_unavailable: ${sandboxUnavailableMessage(error)}`
          );
        }
      } else if (
        !windowsInitializationConfig ||
        !windowsConfigCovers(windowsInitializationConfig, requiredConfig)
      ) {
        throw new Error(
          "remote_sandbox_busy: another Windows WebUI agent is using a different isolated workspace; wait for it to finish and retry"
        );
      }

      const environment = windowsCommandEnvironment(
        input.env,
        adapterSandbox.env
      );
      if (binaryAlias) {
        environment.NODE_OPTIONS = windowsNodeOptions(input.env.NODE_OPTIONS);
      }
      let command: string;
      let shell: WindowsBinShell;
      if (windowsStdinPath && windowsBridgeNodeBinary) {
        const runnerPayload = Buffer.from(
          JSON.stringify({
            ...(aliasedNodeEntry
              ? { entry: aliasedNodeEntry }
              : { bin: binaryAlias?.binary ?? binary ?? input.bin }),
            args: input.args,
            env: environment,
            workspace: workspaceRoot,
            stdin: windowsStdinPath
          })
        ).toString("base64url");
        command = runnerPayload;
        shell = {
          exe: windowsBridgeNodeBinary,
          args: [
            "--preserve-symlinks",
            "--preserve-symlinks-main",
            "--input-type=module",
            "-e",
            WINDOWS_NODE_RUNNER
          ]
        };
      } else {
        const environmentStatements = Object.entries(environment).map(
          ([key, value]) =>
            `[Environment]::SetEnvironmentVariable(${quotePowerShell(key)}, ${quotePowerShell(value)}, 'Process')`
        );
        command = [
          ...environmentStatements,
          `& ${[
            windowsLaunchBinary,
            ...windowsLaunchArgs
          ].map(quotePowerShell).join(" ")}`,
          "exit $LASTEXITCODE"
        ].join("; ");
        shell = {
          exe: windowsPowerShell(input.env),
          args: [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command"
          ]
        };
      }
      try {
        const wrapped = await SandboxManager.wrapWithSandboxArgv(
          command,
          shell,
          { git: { safeDirectories: [workspaceRoot] } },
          undefined,
          input.cwd
        );
        windowsActiveCommands += 1;
        return {
          bin: wrapped.argv[0]!,
          args: wrapped.argv.slice(1),
          env: { ...input.env, ...wrapped.env, ...adapterSandbox.env },
          ...(windowsStdinPath ? { stdinPath: windowsStdinPath } : {})
        };
      } catch (error) {
        if (windowsActiveCommands === 0) await startWindowsReset();
        throw error;
      }
    });
  }

  await ensureInitialized();
  const useIpv6Proxy = await ensureIpv6ProxyBridge(input.adapter);
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
        allowWrite,
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
  if (process.platform !== "win32" || windowsActiveCommands <= 0) return;
  windowsActiveCommands -= 1;
  if (windowsActiveCommands > 0 || windowsReset) return;

  void startWindowsReset();
}
