const ALLOW =
  /^(PATH|HOME|USER|USERNAME|TMPDIR|TEMP|TMP|LANG|LC_.*|TZ|NODE_ENV|FORCE_COLOR|NO_COLOR|TERM|FB_.*|FREEBUDDY_.*|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT)$/i;
const DENY =
  /token|secret|password|authorization|credential|cookie|private.?key|api.?key|access.?key|npm_|gh_|github_|aws_|azure_|google_application/i;
const DENY_EXACT = new Set([
  "NODE_OPTIONS",
  "NODE_DEBUG",
  "DEBUG",
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_NO_ASAR",
  "OPENSSL_CONF"
]);

export function sanitizedRuntimeProcessEnv(
  version: string,
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "string") continue;
    if (DENY_EXACT.has(key)) continue;
    if (DENY.test(key)) continue;
    if (!ALLOW.test(key)) continue;
    out[key] = value;
  }
  out.FB_RUNTIME_PROCESS = "1";
  out.FB_RUNTIME_VERSION = version;
  return out;
}
