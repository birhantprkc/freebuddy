import { existsSync, readFileSync, realpathSync as fsRealpath } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DSH_ACP_NPM_TAG = "next";

export type CLIAdapterId =
  | "codex"
  | "codex-acp"
  | "claude"
  | "claude-agent-acp"
  | "opencode"
  | "opencode-acp"
  | "cursor-agent-acp"
  | "kimi-acp"
  | "qoder-acp"
  | "codebuddy-acp"
  | "grok-acp"
  | "agy-acp"
  | "dsh-acp"
  | (string & {});

export type CLIStreamMode =
  | "codex-json"
  | "claude-json"
  | "opencode-json"
  | "raw";

export interface CLIAdapterDefinition {
  id: CLIAdapterId;
  label: string;
  defaultBinary: string;
  checkProbe?: CliCheckProbe;
  streamMode: CLIStreamMode;
  commandGroup: string;
  capabilities: {
    toolSession: boolean;
    skills?: {
      mode: "native" | "mcp";
      nativeDirs?: string[];
      reloadPolicy: "process-start" | "new-session";
    };
  };
  /** Args that, when present in user extraArgs, indicate the user is already
   *  controlling tool-session resume manually. */
  toolSessionArgs: string[];
  toolSessionArgPrefixes: string[];
  installHint?: string;
  docsUrl?: string;
  protocol?: "legacy-cli-json" | "acp";
}

export interface CliCheckProbe {
  args: string[];
  versionOptional: boolean;
  /**
   * Skip spawning the binary. Used for ACP stdio servers that have no
   * `--version` and would otherwise hang on stdin.
   */
  skipSpawn?: boolean;
}

const legacyAdapterDefinitions: CLIAdapterDefinition[] = [
  {
    id: "codex",
    label: "Codex Legacy",
    defaultBinary: "codex",
    streamMode: "codex-json",
    commandGroup: "codex",
    capabilities: { toolSession: true, skills: { mode: "native", nativeDirs: [".agents/skills"], reloadPolicy: "process-start" } },
    toolSessionArgs: ["resume", "--last"],
    toolSessionArgPrefixes: [],
    installHint: "npm install -g @openai/codex",
    docsUrl: "https://github.com/openai/codex",
    protocol: "legacy-cli-json"
  },
  {
    id: "claude",
    label: "Claude Code Legacy",
    defaultBinary: "claude",
    streamMode: "claude-json",
    commandGroup: "claude",
    capabilities: { toolSession: true, skills: { mode: "native", nativeDirs: [".claude/skills"], reloadPolicy: "process-start" } },
    toolSessionArgs: ["--resume", "-r", "--continue", "-c", "--session-id"],
    toolSessionArgPrefixes: ["--resume=", "--session-id="],
    installHint: "npm install -g @anthropic-ai/claude-code",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code",
    protocol: "legacy-cli-json"
  },
  {
    id: "opencode",
    label: "OpenCode Legacy",
    defaultBinary: "opencode",
    streamMode: "opencode-json",
    commandGroup: "opencode",
    capabilities: { toolSession: true, skills: { mode: "native", nativeDirs: [".opencode/skills"], reloadPolicy: "process-start" } },
    toolSessionArgs: ["--session", "-s", "--continue", "-c"],
    toolSessionArgPrefixes: ["--session="],
    installHint: "npm install -g opencode-ai",
    docsUrl: "https://opencode.ai/docs",
    protocol: "legacy-cli-json"
  }
];

export const cliAdapterDefinitions: CLIAdapterDefinition[] = [
  {
    id: "codex-acp",
    label: "Codex",
    defaultBinary: "codex-acp",
    checkProbe: { args: ["--version"], versionOptional: false },
    streamMode: "raw",
    commandGroup: "codex",
    capabilities: { toolSession: true, skills: { mode: "native", nativeDirs: [".agents/skills"], reloadPolicy: "process-start" } },
    toolSessionArgs: [],
    toolSessionArgPrefixes: [],
    installHint: "npm install -g --force @agentclientprotocol/codex-acp",
    docsUrl: "https://github.com/agentclientprotocol/codex-acp",
    protocol: "acp"
  },
  {
    id: "claude-agent-acp",
    label: "ClaudeCode",
    defaultBinary: "claude-agent-acp",
    checkProbe: { args: ["--cli", "--version"], versionOptional: false },
    streamMode: "raw",
    commandGroup: "claude",
    capabilities: { toolSession: true, skills: { mode: "native", nativeDirs: [".claude/skills"], reloadPolicy: "process-start" } },
    toolSessionArgs: [],
    toolSessionArgPrefixes: [],
    installHint:
      "npm install -g --include=optional @agentclientprotocol/claude-agent-acp",
    docsUrl: "https://github.com/agentclientprotocol/claude-agent-acp",
    protocol: "acp"
  },
  {
    id: "opencode-acp",
    label: "OpenCode",
    defaultBinary: "opencode",
    streamMode: "raw",
    commandGroup: "opencode",
    capabilities: { toolSession: true, skills: { mode: "native", nativeDirs: [".opencode/skills"], reloadPolicy: "process-start" } },
    toolSessionArgs: [],
    toolSessionArgPrefixes: [],
    installHint: "npm install -g opencode-ai",
    docsUrl: "https://opencode.ai/docs",
    protocol: "acp"
  },
  {
    id: "cursor-agent-acp",
    label: "Cursor",
    defaultBinary: "cursor-agent",
    streamMode: "raw",
    commandGroup: "cursor",
    capabilities: { toolSession: true, skills: { mode: "mcp", reloadPolicy: "new-session" } },
    toolSessionArgs: [],
    toolSessionArgPrefixes: [],
    installHint:
      process.platform === "win32"
        ? "irm 'https://cursor.com/install?win32=true' | iex"
        : "curl https://cursor.com/install -fsS | bash",
    docsUrl: "https://docs.cursor.com/en/cli/overview",
    protocol: "acp"
  },
  {
    id: "kimi-acp",
    label: "Kimi",
    defaultBinary: "kimi",
    streamMode: "raw",
    commandGroup: "kimi",
    capabilities: { toolSession: true, skills: { mode: "native", nativeDirs: [".kimi/skills"], reloadPolicy: "process-start" } },
    toolSessionArgs: [],
    toolSessionArgPrefixes: [],
    installHint:
      process.platform === "win32"
        ? "irm https://code.kimi.com/kimi-code/install.ps1 | iex"
        : "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
    docsUrl: "https://moonshotai.github.io/kimi-code/en/guides/ides",
    protocol: "acp"
  },
  {
    id: "qoder-acp",
    label: "Qoder",
    defaultBinary: "qodercli",
    streamMode: "raw",
    commandGroup: "qoder",
    capabilities: { toolSession: true, skills: { mode: "mcp", reloadPolicy: "new-session" } },
    toolSessionArgs: [],
    toolSessionArgPrefixes: [],
    installHint:
      process.platform === "win32"
        ? "irm https://qoder.com/install.ps1 | iex"
        : "curl -fsSL https://qoder.com/install | bash",
    docsUrl: "https://docs.qoder.com/en/cli/acp",
    protocol: "acp"
  },
  {
    id: "codebuddy-acp",
    label: "CodeBuddy",
    defaultBinary: "codebuddy",
    checkProbe: { args: ["--version"], versionOptional: false },
    streamMode: "raw",
    commandGroup: "codebuddy",
    capabilities: { toolSession: true, skills: { mode: "native", nativeDirs: [".codebuddy/skills"], reloadPolicy: "process-start" } },
    toolSessionArgs: [],
    toolSessionArgPrefixes: [],
    installHint: "npm install -g @tencent-ai/codebuddy-code",
    docsUrl: "https://www.codebuddy.cn/docs/cli/acp",
    protocol: "acp"
  },
  {
    id: "grok-acp",
    label: "Grok",
    defaultBinary: "grok",
    checkProbe: { args: ["version"], versionOptional: false },
    streamMode: "raw",
    commandGroup: "grok",
    capabilities: { toolSession: true, skills: { mode: "mcp", reloadPolicy: "new-session" } },
    toolSessionArgs: [],
    toolSessionArgPrefixes: [],
    installHint:
      process.platform === "win32"
        ? "irm https://x.ai/cli/install.ps1 | iex"
        : "curl -fsSL https://x.ai/cli/install.sh | bash",
    docsUrl: "https://docs.x.ai/build/cli/reference",
    protocol: "acp"
  },
  {
    id: "agy-acp",
    label: "Antigravity",
    defaultBinary: "agy-acp",
    checkProbe: { args: ["--version"], versionOptional: true },
    streamMode: "raw",
    commandGroup: "antigravity",
    capabilities: { toolSession: true, skills: { mode: "native", nativeDirs: [".agents/skills"], reloadPolicy: "process-start" } },
    toolSessionArgs: [],
    toolSessionArgPrefixes: [],
    installHint: "npm install -g agy-acp-bridge",
    docsUrl: "https://github.com/maojindao55/agy-acp",
    protocol: "acp"
  },
  {
    id: "dsh-acp",
    label: "DeepSeek",
    defaultBinary: "dsh-acp-demo",
    // The bin only accepts `--config`; `--version` exits non-zero via parseArgs.
    checkProbe: { args: [], versionOptional: true, skipSpawn: true },
    streamMode: "raw",
    commandGroup: "deepseek",
    capabilities: {
      toolSession: true,
      skills: { mode: "native", nativeDirs: [".dsh/skills"], reloadPolicy: "process-start" }
    },
    toolSessionArgs: [],
    toolSessionArgPrefixes: [],
    // `latest` is still 0.0.1-rc.1; that release's peer packages 404 on the
    // public registry. The working public line is currently tagged `next`.
    // The published ACP demo has no runtime dependencies; cordis.yml plugins
    // must be installed alongside it. koffi's install script rebuilds from
    // source when the optional platform binary is missing; that CMake path
    // exceeds Windows MAX_PATH under the nested global install, so keep the
    // prebuild and skip lifecycle scripts.
    installHint: dshAcpInstallCommand(),
    docsUrl: "https://github.com/deepseek-ai/deepseek-harness",
    protocol: "acp"
  }
];

const allAdapterDefinitions = [
  ...legacyAdapterDefinitions,
  ...cliAdapterDefinitions
];

const definitionsById = new Map(
  allAdapterDefinitions.map((definition) => [definition.id, definition])
);

export function getAdapterDefinition(
  adapter: string
): CLIAdapterDefinition | undefined {
  return definitionsById.get(adapter as CLIAdapterId);
}

export function adapterBinary(adapter: string): string | undefined {
  return definitionsById.get(adapter as CLIAdapterId)?.defaultBinary;
}

export function getCliCheckProbe(adapter: string): CliCheckProbe {
  return (
    definitionsById.get(adapter as CLIAdapterId)?.checkProbe ?? {
      args: ["--version"],
      versionOptional: false
    }
  );
}

/**
 * DeepSeek Harness ACP is automation-only and rejects non-empty `mcpServers`
 * on `session/new`. Other adapters accept FreeBuddy's Draft/Browser/skill MCP.
 */
export function adapterAcceptsClientMcpServers(adapter: string): boolean {
  return adapter !== "dsh-acp";
}

/**
 * Force koffi to keep its optional platform prebuild. Its install script
 * otherwise rebuilds from source, and that CMake path exceeds Windows MAX_PATH
 * under the nested global `@deepseek-ai/dsh-acp-demo` install.
 */
export function applyDshAcpNpmInstallEnv(
  adapter: string,
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  if (adapter !== "dsh-acp") return env;
  return {
    ...env,
    npm_config_ignore_scripts: "true",
    npm_config_include: "optional",
    npm_config_optional: "true"
  };
}

export function dshAcpWindowsResiduePath(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  if (process.platform !== "win32") return undefined;
  const appdata = env.APPDATA?.trim();
  if (!appdata) return undefined;
  return path.join(appdata, "npm", "node_modules", "@deepseek-ai");
}

export function extraArgsHaveDshConfig(args: string[]): boolean {
  return args.some(
    (arg) =>
      arg === "-c" ||
      arg === "--config" ||
      arg.startsWith("-c=") ||
      arg.startsWith("--config=")
  );
}

/** Packaged extraResources, else the repo `assets/dsh/cordis.yml` used in dev. */
export function bundledDshAcpConfigPath(): string {
  const fromSource = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "assets",
    "dsh",
    "cordis.yml"
  );
  const packaged =
    typeof process.resourcesPath === "string"
      ? path.join(process.resourcesPath, "dsh", "cordis.yml")
      : "";
  if (packaged && existsSync(packaged)) return packaged;
  return fromSource;
}

/**
 * `dsh-acp-demo` defaults to `./cordis.yml` in the session cwd. Prefer a
 * workspace file when present; otherwise use FreeBuddy's bundled default.
 */
export function resolveDshAcpConfigPath(
  cwd?: string,
  runtimeRoot?: string
): string {
  if (cwd) {
    const local = path.join(cwd, "cordis.yml");
    if (existsSync(local)) return local;
  }
  if (runtimeRoot) {
    const managed = path.join(runtimeRoot, "cordis.yml");
    if (existsSync(managed)) return managed;
  }
  return bundledDshAcpConfigPath();
}

export const DSH_ACP_PLUGIN_TREE_MISSING = "DeepSeek ACP plugin tree missing";
export const DSH_ACP_PROBE_PACKAGE = "@deepseek-ai/dsh-llm-deepseek";

export function dshAcpManagedRoot(dataDir: string): string {
  return path.join(dataDir, "runtimes", "dsh-acp");
}

export function dshAcpManagedDemoBin(dataDir: string): string {
  return path.join(
    dshAcpManagedRoot(dataDir),
    "node_modules",
    "@deepseek-ai",
    "dsh-acp-demo",
    "lib",
    "bin.js"
  );
}

export function quoteForShell(value: string): string {
  if (process.platform === "win32") {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Walk up from `startDir` looking for `node_modules/<package>`. */
export function nodeModulesHasPackage(
  startDir: string,
  packageName: string
): boolean {
  let dir = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(dir, "node_modules", packageName, "package.json"))) {
      return true;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export function resolveDshAcpDemoDirFromBinary(
  binPath: string
): string | undefined {
  let current = path.resolve(binPath);
  try {
    current = fsRealpath(binPath);
  } catch {
    /* keep resolved path */
  }
  if (/\.(cmd|ps1|bat)$/i.test(current)) {
    try {
      const text = readFileSync(current, "utf8");
      const match = text.match(
        /node_modules[/\\]@deepseek-ai[/\\]dsh-acp-demo[/\\]lib[/\\]bin\.js/i
      );
      if (match) {
        const pkg = path.resolve(
          path.dirname(current),
          match[0].replace(/[/\\]lib[/\\]bin\.js$/i, "")
        );
        if (existsSync(path.join(pkg, "package.json"))) return pkg;
      }
    } catch {
      /* ignore unreadable shims */
    }
  }
  if (current.endsWith(`${path.sep}lib${path.sep}bin.js`)) {
    const pkg = path.dirname(path.dirname(current));
    if (existsSync(path.join(pkg, "package.json"))) return pkg;
  }
  return undefined;
}

export function dshAcpCompositionReady(binPath: string): boolean {
  const pkgDir = resolveDshAcpDemoDirFromBinary(binPath) ?? path.dirname(binPath);
  return nodeModulesHasPackage(pkgDir, DSH_ACP_PROBE_PACKAGE);
}

/** Bare npm package names referenced by the bundled ACP composition. */
export function parseDshAcpCompositionPackages(yamlText: string): string[] {
  const names = new Set<string>(["@deepseek-ai/dsh-acp-demo"]);
  for (const match of yamlText.matchAll(/^\s*name:\s*'(@deepseek-ai\/[^']+)'/gm)) {
    names.add(match[1].split("/").slice(0, 2).join("/"));
  }
  return [...names];
}

/**
 * `dsh-acp-demo` ships with `deps: none`. Installing only the bin leaves
 * cordis unable to import `@deepseek-ai/dsh-llm-deepseek` and the rest of
 * the official ACP plugin tree (`ERR_MODULE_NOT_FOUND`).
 */
export function dshAcpInstallCommand(options?: {
  yamlText?: string;
  prefix?: string;
}): string {
  const yamlText =
    options?.yamlText ?? readFileSync(bundledDshAcpConfigPath(), "utf8");
  const specs = parseDshAcpCompositionPackages(yamlText).map(
    (pkg) => `${pkg}@${DSH_ACP_NPM_TAG}`
  );
  specs.sort((a, b) => {
    if (a.startsWith("@deepseek-ai/dsh-acp-demo@")) return -1;
    if (b.startsWith("@deepseek-ai/dsh-acp-demo@")) return 1;
    return a.localeCompare(b);
  });
  const target = options?.prefix
    ? `--prefix ${quoteForShell(options.prefix)}`
    : "-g";
  return `npm install ${target} --include=optional --ignore-scripts ${specs.join(" ")}`;
}

export function hasExplicitToolSessionArg(
  adapter: string | null | undefined,
  extraArgs: string[] | null | undefined
): boolean {
  if (!adapter || !extraArgs?.length) return false;
  const def = getAdapterDefinition(adapter);
  if (!def) return false;
  return extraArgs.some(
    (arg) =>
      def.toolSessionArgs.includes(arg) ||
      def.toolSessionArgPrefixes.some((prefix) => arg.startsWith(prefix))
  );
}

export interface BuildCommandInput {
  adapter: string;
  binary?: string;
  prompt: string;
  extraArgs?: string[];
  cwd?: string;
  toolSessionId?: string;
  /** Absolute multi-folder project roots; OpenCode gets external_directory allows when length > 1. */
  workspaceRoots?: string[];
  /** FreeBuddy-managed `runtimes/dsh-acp` prefix; used when no custom binary. */
  dshAcpRuntimeRoot?: string;
}

export interface BuiltCommand {
  bin: string;
  args: string[];
  env?: Record<string, string>;
  /** When true, the prompt is delivered via stdin instead of argv. */
  promptViaStdin: boolean;
  protocol?: "legacy-cli-json" | "acp";
}

function parseCodexConfigValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("{")
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function setDottedConfigValue(
  target: Record<string, unknown>,
  key: string,
  value: unknown
) {
  const parts = key.split(".").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return;
  let cursor: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

function normalizeCodexAcpArgs(args: string[]): {
  args: string[];
  env?: Record<string, string>;
} {
  const normalized: string[] = [];
  const config: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-m" || arg === "--model") {
      const model = args[i + 1];
      if (model) {
        config.model = model;
        i += 1;
        continue;
      }
    }
    if (arg.startsWith("--model=")) {
      config.model = arg.slice("--model=".length);
      continue;
    }
    if (arg === "-c" || arg === "--config") {
      const pair = args[i + 1];
      if (pair) {
        const eq = pair.indexOf("=");
        if (eq > 0) {
          setDottedConfigValue(
            config,
            pair.slice(0, eq),
            parseCodexConfigValue(pair.slice(eq + 1))
          );
        }
        i += 1;
        continue;
      }
    }
    if (arg.startsWith("-c=") || arg.startsWith("--config=")) {
      const pair = arg.slice(arg.indexOf("=") + 1);
      const eq = pair.indexOf("=");
      if (eq > 0) {
        setDottedConfigValue(
          config,
          pair.slice(0, eq),
          parseCodexConfigValue(pair.slice(eq + 1))
        );
      }
      continue;
    }
    normalized.push(arg);
  }
  return {
    args: normalized,
    ...(Object.keys(config).length
      ? { env: { CODEX_CONFIG: JSON.stringify(config) } }
      : {})
  };
}

function splitModelArg(args: string[]): {
  model?: string;
  args: string[];
} {
  const rest: string[] = [];
  let model: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-m" || arg === "--model") {
      const value = args[i + 1];
      if (value) {
        model = value;
        i += 1;
        continue;
      }
    }
    if (arg.startsWith("--model=")) {
      model = arg.slice("--model=".length);
      continue;
    }
    rest.push(arg);
  }
  return { model, args: rest };
}

/** Build OpenCode OPENCODE_CONFIG_CONTENT object (model + multi-root permission). */
export function buildOpenCodeConfigContent(input: {
  model?: string;
  workspaceRoots?: string[];
}): Record<string, unknown> | undefined {
  const content: Record<string, unknown> = {};
  if (input.model) {
    content.model = input.model;
  }

  const roots = (input.workspaceRoots ?? [])
    .map((raw) => {
      if (typeof raw !== "string") return "";
      const trimmed = raw.trim();
      if (!trimmed) return "";
      try {
        return path.resolve(trimmed).replace(/[/\\]+$/, "");
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  const uniqueRoots = [...new Set(roots)];
  if (uniqueRoots.length > 1) {
    const externalDirectory: Record<string, "allow"> = {};
    for (const root of uniqueRoots) {
      const pattern = `${root.replace(/\\/g, "/")}/**`;
      externalDirectory[pattern] = "allow";
    }
    content.permission = { external_directory: externalDirectory };
  }

  return Object.keys(content).length > 0 ? content : undefined;
}

/**
 * Per-adapter command construction. The result is fed straight to spawn().
 * Stream parsing happens in the renderer; here we only assemble argv that
 * makes the CLI emit a structured/JSON stream we can later parse.
 */
export function buildCommand(input: BuildCommandInput): BuiltCommand {
  const def = getAdapterDefinition(input.adapter);
  const bin = (input.binary?.trim() || def?.defaultBinary || input.adapter).trim();
  const extra = (input.extraArgs || []).filter((a) => a != null && a !== "");

  switch (input.adapter) {
    case "codex": {
      if (input.toolSessionId && !hasExplicitToolSessionArg("codex", extra)) {
        const args: string[] = ["exec", "resume", "--json"];
        args.push(...extra);
        args.push(input.toolSessionId, input.prompt);
        return { bin, args, promptViaStdin: false, protocol: "legacy-cli-json" };
      }
      const args: string[] = ["exec", "--json", "--color", "never"];
      args.push(...extra);
      args.push(input.prompt);
      return { bin, args, promptViaStdin: false, protocol: "legacy-cli-json" };
    }
    case "codex-acp": {
      const normalized = normalizeCodexAcpArgs(extra);
      return {
        bin,
        args: normalized.args,
        ...(normalized.env ? { env: normalized.env } : {}),
        promptViaStdin: false,
        protocol: "acp"
      };
    }
    case "claude-agent-acp": {
      const { model, args } = splitModelArg(extra);
      return {
        bin,
        args,
        ...(model ? { env: { ANTHROPIC_MODEL: model } } : {}),
        promptViaStdin: false,
        protocol: "acp"
      };
    }
    case "opencode-acp": {
      const { model, args: acpArgs } = splitModelArg(extra);
      const args: string[] = ["acp"];
      if (input.cwd) args.push("--cwd", input.cwd);
      args.push(...acpArgs);
      const configContent = buildOpenCodeConfigContent({
        model,
        workspaceRoots: input.workspaceRoots
      });
      return {
        bin,
        args,
        ...(configContent
          ? { env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(configContent) } }
          : {}),
        promptViaStdin: false,
        protocol: "acp"
      };
    }
    case "cursor-agent-acp": {
      const { model, args: globalArgs } = splitModelArg(extra);
      const args: string[] = [];
      if (model) args.push("--model", model);
      args.push(...globalArgs, "acp");
      return {
        bin,
        args,
        promptViaStdin: false,
        protocol: "acp"
      };
    }
    case "kimi-acp": {
      const { model, args: acpArgs } = splitModelArg(extra);
      const args: string[] = ["acp"];
      args.push(...acpArgs);
      return {
        bin,
        args,
        ...(model ? { env: { KIMI_MODEL_NAME: model } } : {}),
        promptViaStdin: false,
        protocol: "acp"
      };
    }
    case "qoder-acp": {
      const args: string[] = ["--acp"];
      args.push(...extra);
      return {
        bin,
        args,
        promptViaStdin: false,
        protocol: "acp"
      };
    }
    case "codebuddy-acp": {
      const args: string[] = ["--acp"];
      args.push(...extra);
      return {
        bin,
        args,
        promptViaStdin: false,
        protocol: "acp"
      };
    }
    case "grok-acp": {
      const args: string[] = [...extra, "agent", "stdio"];
      return {
        bin,
        args,
        promptViaStdin: false,
        protocol: "acp"
      };
    }
    case "agy-acp": {
      const args: string[] = [...extra];
      return {
        bin,
        args,
        promptViaStdin: false,
        protocol: "acp"
      };
    }
    case "dsh-acp": {
      const managedBin = input.dshAcpRuntimeRoot
        ? path.join(
            input.dshAcpRuntimeRoot,
            "node_modules",
            "@deepseek-ai",
            "dsh-acp-demo",
            "lib",
            "bin.js"
          )
        : "";
      const useManaged =
        !input.binary?.trim() &&
        Boolean(managedBin) &&
        existsSync(managedBin) &&
        dshAcpCompositionReady(managedBin);
      const args = extraArgsHaveDshConfig(extra)
        ? [...extra]
        : [
            "--config",
            resolveDshAcpConfigPath(input.cwd, input.dshAcpRuntimeRoot),
            ...extra
          ];
      if (useManaged) {
        return {
          bin: "node",
          args: [managedBin, ...args],
          promptViaStdin: false,
          protocol: "acp"
        };
      }
      return {
        bin,
        args,
        promptViaStdin: false,
        protocol: "acp"
      };
    }
    case "claude": {
      const args: string[] = [
        "--print",
        "--output-format",
        "stream-json",
        "--verbose"
      ];
      if (input.toolSessionId && !hasExplicitToolSessionArg("claude", extra)) {
        args.push("--resume", input.toolSessionId);
      }
      args.push(...extra);
      args.push(input.prompt);
      return { bin, args, promptViaStdin: false, protocol: "legacy-cli-json" };
    }
    case "opencode": {
      const args: string[] = ["run", "--print-logs"];
      if (input.toolSessionId && !hasExplicitToolSessionArg("opencode", extra)) {
        args.push("--session", input.toolSessionId);
      }
      args.push(...extra);
      args.push(input.prompt);
      return { bin, args, promptViaStdin: false, protocol: "legacy-cli-json" };
    }
    default: {
      const args = [...extra];
      return { bin, args, promptViaStdin: true, protocol: "legacy-cli-json" };
    }
  }
}
