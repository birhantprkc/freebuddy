/** Last 1–2 path segments for compact UI. */
export function shortPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).slice(-2).join("/") || path;
}

/** Collapse home prefix to ~ on macOS/Linux/Windows when possible. */
export function formatDisplayPath(raw: string): string {
  const normalized = raw.replace(/[\\/]+$/, "") || raw;
  const unixHome =
    normalized.match(/^(\/Users\/[^/]+)/)?.[1] ??
    normalized.match(/^(\/home\/[^/]+)/)?.[1];
  if (unixHome && normalized.startsWith(unixHome)) {
    const rest = normalized.slice(unixHome.length);
    return rest ? `~${rest.replace(/\\/g, "/")}` : "~";
  }
  const winHome = normalized.match(/^([A-Za-z]:\\Users\\[^\\/]+)/i)?.[1];
  if (winHome && normalized.toLowerCase().startsWith(winHome.toLowerCase())) {
    const rest = normalized.slice(winHome.length).replace(/\\/g, "/");
    return rest ? `~${rest}` : "~";
  }
  return normalized;
}

export function folderBaseName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

export function pathsEqual(a: string, b: string): boolean {
  const norm = (value: string) =>
    value.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
  return norm(a) === norm(b);
}
