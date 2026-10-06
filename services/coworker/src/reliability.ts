import type { TaskState } from "./worker.js";
export function summarizeReliability(tasks: TaskState[], now = Date.now()) {
  const paid = tasks.filter(t => t.paid);
  const verified = paid.filter(t => t.stage === "settled" && t.settlement?.verified && t.settlement.txHash);
  const failed = paid.filter(t => t.stage === "failed");
  const ongoing = paid.filter(t => !["settled", "failed"].includes(t.stage));
  return { observedAt: new Date(now).toISOString(), paidTasksSeen: paid.length, paidCollectionsVerified: verified.length,
    paidTasksFailed: failed.length, paidTasksOngoing: ongoing.length,
    paidTasksWithDeliveredReport: paid.filter(t => t.delivered && t.completionEventId).length,
    staleOngoing: ongoing.filter(t => !t.updatedAt || now - Date.parse(t.updatedAt) > 120000).length,
    successFractionAmongTerminal: verified.length + failed.length ? verified.length / (verified.length + failed.length) : null,
    scope: "Observed local Task state, including historical failures. This is not an uptime SLA or a statistically validated marketplace success rate." };
}
