export type TaskReceiptResult = "success" | "failure";

export interface TaskReceiptCompletion {
  id: string;
  title: string;
  result: TaskReceiptResult;
  completedAt: string;
  conversationId?: string;
}

export interface TaskReceiptSummary {
  dayKey: string;
  successCount: number;
  totalCount: number;
  completionRate: number;
  streakDays: number;
  representativeTasks: string[];
}

export const TASK_RECEIPT_AUTO_OPEN_COUNT = 3;
export const TASK_RECEIPT_MAX_EVENTS = 300;

export function taskReceiptDayKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeTaskReceiptCompletion(
  input: TaskReceiptCompletion
): TaskReceiptCompletion | null {
  const id = input.id.trim().slice(0, 200);
  const title = input.title.trim().replace(/[\r\n]+/g, " ").slice(0, 120);
  const completedAt = new Date(input.completedAt);
  if (
    !id ||
    !title ||
    (input.result !== "success" && input.result !== "failure") ||
    !Number.isFinite(completedAt.getTime())
  ) {
    return null;
  }
  const conversationId = input.conversationId?.trim().slice(0, 200);
  return {
    id,
    title,
    result: input.result,
    completedAt: completedAt.toISOString(),
    ...(conversationId ? { conversationId } : {})
  };
}

export function pruneTaskReceiptCompletions(
  completions: TaskReceiptCompletion[]
): TaskReceiptCompletion[] {
  const seen = new Set<string>();
  return completions
    .map(normalizeTaskReceiptCompletion)
    .filter((completion): completion is TaskReceiptCompletion => {
      if (!completion || seen.has(completion.id)) return false;
      seen.add(completion.id);
      return true;
    })
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
    .slice(0, TASK_RECEIPT_MAX_EVENTS);
}

export function buildTaskReceiptSummary(
  completions: TaskReceiptCompletion[],
  now = new Date()
): TaskReceiptSummary {
  const dayKey = taskReceiptDayKey(now);
  const normalized = pruneTaskReceiptCompletions(completions);
  const today = normalized.filter(
    (completion) => taskReceiptDayKey(completion.completedAt) === dayKey
  );
  const successes = today.filter((completion) => completion.result === "success");
  const representativeTasks = Array.from(
    new Set(successes.map((completion) => completion.title))
  ).slice(0, 3);
  const successfulDays = new Set(
    normalized
      .filter((completion) => completion.result === "success")
      .map((completion) => taskReceiptDayKey(completion.completedAt))
      .filter(Boolean)
  );
  let streakDays = 0;
  const cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);
  while (successfulDays.has(taskReceiptDayKey(cursor))) {
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    dayKey,
    successCount: successes.length,
    totalCount: today.length,
    completionRate:
      today.length > 0 ? Math.round((successes.length / today.length) * 100) : 0,
    streakDays,
    representativeTasks
  };
}

export function shouldAutoOpenTaskReceipt(
  summary: TaskReceiptSummary,
  result: TaskReceiptResult,
  autoOpenedDay?: string,
  enabled = false
): boolean {
  return (
    enabled &&
    result === "success" &&
    summary.successCount >= TASK_RECEIPT_AUTO_OPEN_COUNT &&
    autoOpenedDay !== summary.dayKey
  );
}
