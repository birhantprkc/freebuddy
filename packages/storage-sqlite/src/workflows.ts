import type {
  WorkflowRunRow,
  WorkflowRunStatus,
  WorkflowStepRow,
  WorkflowStepStatus
} from "@freebuddy/protocol/workflow";
import type { CreateWorkflowRunInput, CreateWorkflowStepInput } from "@freebuddy/workflow-runtime";
import { ownsConversation } from "./owner.js";
import type { SqliteStoreContext } from "./types.js";

function nowIso(ctx: SqliteStoreContext): string {
  return ctx.nowIso?.() ?? new Date().toISOString();
}

export function rowToWorkflowRun(r: Record<string, unknown>): WorkflowRunRow {
  return {
    id: String(r.id),
    conversationId: (r.conversation_id as string | null) ?? undefined,
    teamId: (r.team_id as string | null) ?? undefined,
    teamSnapshotJson: (r.team_snapshot_json as string | null) ?? undefined,
    planVersion: (r.plan_version as number | null) ?? undefined,
    name: String(r.name),
    goal: String(r.goal),
    status: r.status as WorkflowRunStatus,
    cwd: (r.cwd as string | null) ?? undefined,
    template: (r.template as string | null) ?? undefined,
    loopIndex: Number(r.loop_index ?? 0),
    maxLoops: Number(r.max_loops ?? 1),
    planJson: String(r.plan_json ?? "{}"),
    summary: (r.summary as string | null) ?? undefined,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    endedAt: (r.ended_at as string | null) ?? undefined,
    runtimeVersion: (r.runtime_version as string | null) ?? undefined,
    runtimeApiVersion: (r.runtime_api_version as string | null) ?? undefined
  };
}

export function rowToWorkflowStep(r: Record<string, unknown>): WorkflowStepRow {
  let dependsOn: string[] | undefined;
  if (r.depends_on) {
    try {
      const parsed = JSON.parse(String(r.depends_on));
      if (Array.isArray(parsed)) dependsOn = parsed;
    } catch {
      dependsOn = undefined;
    }
  }
  let targetPaths: string[] | undefined;
  if (r.target_paths) {
    try {
      const parsed = JSON.parse(String(r.target_paths));
      if (Array.isArray(parsed)) targetPaths = parsed;
    } catch {
      targetPaths = undefined;
    }
  }

  return {
    id: String(r.id),
    workflowRunId: String(r.workflow_run_id),
    phaseId: String(r.phase_id),
    stepId: String(r.step_id),
    title: String(r.title),
    agentId: String(r.agent_id),
    agentName: String(r.agent_name),
    adapter: String(r.adapter),
    mode: r.mode as WorkflowStepRow["mode"],
    status: r.status as WorkflowStepStatus,
    prompt: String(r.prompt),
    dependsOn,
    targetPaths,
    summary: (r.summary as string | null) ?? undefined,
    resultJson: (r.result_json as string | null) ?? undefined,
    cliTaskId: (r.cli_task_id as string | null) ?? undefined,
    toolSessionId: (r.tool_session_id as string | null) ?? undefined,
    startedAt: (r.started_at as string | null) ?? undefined,
    endedAt: (r.ended_at as string | null) ?? undefined,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at)
  };
}

export function createWorkflowRun(
  ctx: SqliteStoreContext,
  input: CreateWorkflowRunInput
): WorkflowRunRow {
  const existing = getWorkflowRun(ctx, input.id);
  if (existing) return existing;
  const now = nowIso(ctx);
  try {
    ctx.db
      .prepare(
        `INSERT INTO workflow_runs
         (id, conversation_id, name, goal, status, cwd, template,
          loop_index, max_loops, plan_json, team_id, team_snapshot_json,
          plan_version, runtime_version, runtime_api_version,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.conversationId ?? null,
        input.name,
        input.goal,
        input.status ?? "pending_approval",
        input.cwd ?? null,
        input.template ?? null,
        input.maxLoops,
        input.planJson,
        input.teamId ?? null,
        input.teamSnapshotJson ?? null,
        input.planVersion ?? 1,
        input.runtimeVersion ?? null,
        input.runtimeApiVersion ?? null,
        now,
        now
      );
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code.startsWith("SQLITE_CONSTRAINT")) {
      const raced = getWorkflowRun(ctx, input.id);
      if (raced) return raced;
    }
    throw error;
  }
  return getWorkflowRun(ctx, input.id) as WorkflowRunRow;
}

export function updateWorkflowRun(
  ctx: SqliteStoreContext,
  id: string,
  patch: Partial<{
    status: WorkflowRunStatus;
    loopIndex: number;
    maxLoops: number;
    planJson: string;
    summary: string | null;
    endedAt: string | null;
  }>
): void {
  const fields: string[] = ["updated_at = ?"];
  const params: unknown[] = [nowIso(ctx)];
  if (patch.status !== undefined) {
    fields.push("status = ?");
    params.push(patch.status);
  }
  if (patch.loopIndex !== undefined) {
    fields.push("loop_index = ?");
    params.push(patch.loopIndex);
  }
  if (patch.maxLoops !== undefined) {
    fields.push("max_loops = ?");
    params.push(patch.maxLoops);
  }
  if (patch.planJson !== undefined) {
    fields.push("plan_json = ?");
    params.push(patch.planJson);
  }
  if (patch.summary !== undefined) {
    fields.push("summary = ?");
    params.push(patch.summary);
  }
  if (patch.endedAt !== undefined) {
    fields.push("ended_at = ?");
    params.push(patch.endedAt);
  }
  params.push(id);
  ctx.db.prepare(`UPDATE workflow_runs SET ${fields.join(", ")} WHERE id = ?`).run(...params);
}

export function getWorkflowRun(
  ctx: SqliteStoreContext,
  id: string
): WorkflowRunRow | undefined {
  const row = ctx.db.prepare(`SELECT * FROM workflow_runs WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  const run = rowToWorkflowRun(row);
  return ownsConversation(ctx.db, ctx.owner, run.conversationId) ? run : undefined;
}

export function listWorkflowRunsByConversation(
  ctx: SqliteStoreContext,
  conversationId: string
): WorkflowRunRow[] {
  if (!ownsConversation(ctx.db, ctx.owner, conversationId)) return [];
  const rows = ctx.db
    .prepare(
      `SELECT * FROM workflow_runs
        WHERE conversation_id = ? AND (kind = 'workflow' OR kind IS NULL)
       ORDER BY created_at DESC`
    )
    .all(conversationId) as Record<string, unknown>[];
  return rows.map(rowToWorkflowRun);
}

export function listActiveWorkflowRuns(ctx: SqliteStoreContext): WorkflowRunRow[] {
  const rows = ctx.db
    .prepare(
      `SELECT * FROM workflow_runs
       WHERE status IN ('running','paused','blocked','pending_approval')
         AND (kind = 'workflow' OR kind IS NULL)
       ORDER BY created_at DESC`
    )
    .all() as Record<string, unknown>[];
  return rows
    .map(rowToWorkflowRun)
    .filter((run) => ownsConversation(ctx.db, ctx.owner, run.conversationId));
}

export function recoverInterruptedWorkflowRuns(ctx: SqliteStoreContext): number {
  const now = nowIso(ctx);
  const rows = ctx.db
    .prepare(
      `SELECT id FROM workflow_runs
        WHERE status = 'running' AND (kind = 'workflow' OR kind IS NULL)`
    )
    .all() as Array<{ id: string }>;

  const updateRunningSteps = ctx.db.prepare(
    `UPDATE workflow_steps
     SET status = 'blocked',
         summary = COALESCE(summary, 'Interrupted by app restart. Resume the workflow to continue.'),
         ended_at = COALESCE(ended_at, ?),
         updated_at = ?
     WHERE workflow_run_id = ? AND status = 'running'`
  );
  const updateRun = ctx.db.prepare(
    `UPDATE workflow_runs
     SET status = 'blocked',
         summary = COALESCE(summary, 'Interrupted by app restart. Resume the workflow to continue.'),
         updated_at = ?
     WHERE id = ? AND status = 'running'`
  );

  const tx = ctx.db.transaction(() => {
    for (const row of rows) {
      updateRunningSteps.run(now, now, row.id);
      updateRun.run(now, row.id);
    }
  });
  tx();
  return rows.length;
}

export function getWorkflowStep(
  ctx: SqliteStoreContext,
  id: string
): WorkflowStepRow | undefined {
  const row = ctx.db.prepare("SELECT * FROM workflow_steps WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToWorkflowStep(row) : undefined;
}

export function createWorkflowStep(
  ctx: SqliteStoreContext,
  input: CreateWorkflowStepInput
): void {
  if (getWorkflowStep(ctx, input.id)) return;
  const now = nowIso(ctx);
  try {
    ctx.db
      .prepare(
        `INSERT INTO workflow_steps
           (id, workflow_run_id, phase_id, step_id, title, agent_id, agent_name,
            adapter, mode, status, prompt, depends_on, target_paths,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.workflowRunId,
        input.phaseId,
        input.stepId,
        input.title,
        input.agentId,
        input.agentName,
        input.adapter,
        input.mode,
        input.prompt,
        input.dependsOn ? JSON.stringify(input.dependsOn) : null,
        input.targetPaths ? JSON.stringify(input.targetPaths) : null,
        now,
        now
      );
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code.startsWith("SQLITE_CONSTRAINT") && getWorkflowStep(ctx, input.id)) return;
    throw error;
  }
}

export function updateWorkflowStep(
  ctx: SqliteStoreContext,
  id: string,
  patch: Partial<{
    status: WorkflowStepStatus;
    prompt: string;
    summary: string | null;
    resultJson: string | null;
    cliTaskId: string | null;
    toolSessionId: string | null;
    startedAt: string | null;
    endedAt: string | null;
  }>
): void {
  const fields: string[] = ["updated_at = ?"];
  const params: unknown[] = [nowIso(ctx)];
  if (patch.status !== undefined) {
    fields.push("status = ?");
    params.push(patch.status);
  }
  if (patch.prompt !== undefined) {
    fields.push("prompt = ?");
    params.push(patch.prompt);
  }
  if (patch.summary !== undefined) {
    fields.push("summary = ?");
    params.push(patch.summary);
  }
  if (patch.resultJson !== undefined) {
    fields.push("result_json = ?");
    params.push(patch.resultJson);
  }
  if (patch.cliTaskId !== undefined) {
    fields.push("cli_task_id = ?");
    params.push(patch.cliTaskId);
  }
  if (patch.toolSessionId !== undefined) {
    fields.push("tool_session_id = ?");
    params.push(patch.toolSessionId);
  }
  if (patch.startedAt !== undefined) {
    fields.push("started_at = ?");
    params.push(patch.startedAt);
  }
  if (patch.endedAt !== undefined) {
    fields.push("ended_at = ?");
    params.push(patch.endedAt);
  }
  params.push(id);
  ctx.db.prepare(`UPDATE workflow_steps SET ${fields.join(", ")} WHERE id = ?`).run(...params);
}

export function getWorkflowSteps(ctx: SqliteStoreContext, runId: string): WorkflowStepRow[] {
  const run = getWorkflowRun(ctx, runId);
  if (!run) return [];
  const rows = ctx.db
    .prepare(
      `SELECT * FROM workflow_steps WHERE workflow_run_id = ?
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(runId) as Record<string, unknown>[];
  return rows.map(rowToWorkflowStep);
}

export function resetWorkflowStepsForLoop(
  ctx: SqliteStoreContext,
  runId: string,
  phaseIds: string[]
): void {
  if (phaseIds.length === 0) return;
  const placeholders = phaseIds.map(() => "?").join(",");
  ctx.db
    .prepare(
      `UPDATE workflow_steps
         SET status = 'pending', summary = NULL, result_json = NULL,
             cli_task_id = NULL, tool_session_id = NULL,
             started_at = NULL, ended_at = NULL,
             updated_at = ?
       WHERE workflow_run_id = ? AND phase_id IN (${placeholders})`
    )
    .run(nowIso(ctx), runId, ...phaseIds);
}
