/** Pure FSM types for the delegation async orchestration bus. */

export type RunStatus = "running" | "blocked" | "completed" | "failed" | "killed";

export type NodeStatus =
  | "idle"
  | "turning"
  | "parked"
  | "done"
  | "failed"
  | "timeout"
  | "cancelled";

export interface BusNode {
  id: string;
  /** null for the synthetic entry root */
  parentId: string | null;
  depth: number;
  status: NodeStatus;
  isEntry: boolean;
}

export interface BusState {
  runId: string;
  runStatus: RunStatus;
  nodes: Record<string, BusNode>;
  /** Entry/root event id */
  entryNodeId: string;
}

export type BusEvent =
  | { type: "TurnStarted"; nodeId: string }
  | { type: "TurnEnded"; nodeId: string; error?: string | null; summary?: string }
  | { type: "ChildSettled"; parentId: string; childId: string; childStatus: string; resultSummary: string; taskText: string; roleLabel: string; verdict?: string | null; verdictSummary?: string | null }
  | { type: "UserFollowUp"; prompt: string }
  | { type: "RunKilled" }
  | { type: "RunBlocked" }
  | { type: "RunUnblocked" };

export type BusEffect =
  | { type: "SpawnWake"; nodeId: string; childId: string; childStatus: string; resultSummary: string; taskText: string; roleLabel: string; verdict?: string | null; verdictSummary?: string | null }
  | { type: "SpawnFollowUp"; prompt: string }
  | { type: "MarkRunCompleted"; summary?: string }
  | { type: "MarkRunFailed"; error: string }
  | { type: "MarkRunKilled" }
  | { type: "MarkNodeTerminal"; nodeId: string; status: "done" | "failed" | "cancelled"; summary?: string };

export interface ReduceResult {
  state: BusState;
  effects: BusEffect[];
}
