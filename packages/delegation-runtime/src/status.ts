export function isTerminalDelegationStatus(status: string): boolean {
  return status === "done" || status === "failed" || status === "timeout" || status === "cancelled";
}
