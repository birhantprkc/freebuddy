function parseVer(value: string): [number, number, number] | null {
  const match = String(value).trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function cmp(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return 0;
}

export function hostApiCompatible(range: string, version: string): boolean {
  const host = parseVer(version);
  if (!host) return false;
  const exact = parseVer(range);
  if (exact && range.trim() === `${exact[0]}.${exact[1]}.${exact[2]}`) {
    return cmp(host, exact) === 0;
  }
  const ge = range.match(/>=(\d+\.\d+\.\d+)/);
  const lt = range.match(/<(\d+\.\d+\.\d+)/);
  if (ge) {
    const bound = parseVer(ge[1]!);
    if (bound && cmp(host, bound) < 0) return false;
  }
  if (lt) {
    const bound = parseVer(lt[1]!);
    if (bound && cmp(host, bound) >= 0) return false;
  }
  if (!ge && !lt) {
    const rangeMajor = parseVer(range)?.[0] ?? Number(/\d+/.exec(range)?.[0]);
    return rangeMajor === host[0];
  }
  return true;
}

export function hostCapabilitiesSatisfied(
  required: readonly string[] | undefined,
  provided: readonly string[]
): string[] {
  return (required ?? []).filter((cap) => !provided.includes(cap));
}
