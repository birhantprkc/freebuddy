import type { DelegationEvent, DelegationVerdict } from "../../delegationTeamTypes.js";

export interface EffectiveWakeVerdict {
  verdict: DelegationVerdict | null;
  verdictSummary: string | null;
}

const TERMINAL = new Set(["done", "failed", "timeout", "cancelled"]);

/**
 * Resolve the verdict a parent should see when waking on `settled`.
 * Prefer the settled event's own verdict; otherwise bubble the latest
 * terminal descendant that submitted one (e.g. implementer → nested review).
 */
export function resolveEffectiveWakeVerdict(
  settled: Pick<DelegationEvent, "id" | "verdict" | "verdictSummary">,
  allEvents: Array<
    Pick<
      DelegationEvent,
      | "id"
      | "parentEventId"
      | "status"
      | "endedAt"
      | "startedAt"
      | "verdict"
      | "verdictSummary"
    >
  >
): EffectiveWakeVerdict {
  if (settled.verdict != null) {
    return {
      verdict: settled.verdict,
      verdictSummary: settled.verdictSummary ?? null
    };
  }

  const byParent = new Map<string, string[]>();
  for (const ev of allEvents) {
    if (!ev.parentEventId) continue;
    const list = byParent.get(ev.parentEventId) ?? [];
    list.push(ev.id);
    byParent.set(ev.parentEventId, list);
  }

  const descendants: typeof allEvents = [];
  const queue = [...(byParent.get(settled.id) ?? [])];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const ev = allEvents.find((e) => e.id === id);
    if (!ev) continue;
    descendants.push(ev);
    for (const childId of byParent.get(id) ?? []) queue.push(childId);
  }

  const withVerdict = descendants.filter(
    (ev) => TERMINAL.has(ev.status) && ev.verdict != null
  );
  if (withVerdict.length === 0) {
    return { verdict: null, verdictSummary: null };
  }

  withVerdict.sort((a, b) => {
    const ta = a.endedAt ?? a.startedAt ?? "";
    const tb = b.endedAt ?? b.startedAt ?? "";
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  const latest = withVerdict[withVerdict.length - 1]!;
  return {
    verdict: latest.verdict ?? null,
    verdictSummary: latest.verdictSummary ?? null
  };
}
