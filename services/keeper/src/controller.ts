export type KeeperStage = "idle" | "sweeping" | "sweep-submitted" | "distributing" | "split-submitted" | "blocked";
export interface KeeperState { stage: KeeperStage; updatedAt: string; sweepTx?: string; splitTx?: string; reason?: string; cycles: number }
export interface KeeperDeps {
  read(): KeeperState; save(s: KeeperState): void;
  run(action: "sweep" | "distribute"): Promise<{ hash?: string; empty: boolean }>;
  confirmed(hash: string): Promise<boolean>; now(): string;
}

/** Persist before each side effect, reconcile submitted hashes, never blindly retry an ambiguous submission. */
export async function keeperTick(d: KeeperDeps): Promise<KeeperState> {
  let s = d.read();
  const save = (stage: KeeperStage, extra: Partial<KeeperState> = {}) => { s = { ...s, ...extra, stage, updatedAt: d.now() }; d.save(s); };
  if (["sweeping", "distributing"].includes(s.stage)) { save("blocked", { reason: "Interrupted during submission; inspect chain evidence before retrying" }); return s; }
  if (s.stage === "blocked") return s;
  try {
    if (s.stage === "idle") {
      save("sweeping", { sweepTx: undefined, splitTx: undefined, reason: undefined });
      const r = await d.run("sweep");
      if (r.hash) save("sweep-submitted", { sweepTx: r.hash });
      else if (r.empty) save("sweep-submitted");
      else throw new Error("Sweep outcome unknown");
    }
    if (s.stage === "sweep-submitted") {
      if (s.sweepTx && !(await d.confirmed(s.sweepTx))) return s;
      save("distributing");
      const r = await d.run("distribute");
      if (r.hash) save("split-submitted", { splitTx: r.hash });
      else if (r.empty) save("idle", { cycles: s.cycles + 1 });
      else throw new Error("Distribution outcome unknown");
    }
    if (s.stage === "split-submitted" && s.splitTx && await d.confirmed(s.splitTx)) save("idle", { cycles: s.cycles + 1 });
  } catch {
    // Read failures after a known submission remain recoverable; uncertain writes require investigation.
    if (["sweeping", "distributing"].includes(s.stage)) save("blocked", { reason: "Submission failed or outcome uncertain; inspect before retrying" });
  }
  return s;
}
