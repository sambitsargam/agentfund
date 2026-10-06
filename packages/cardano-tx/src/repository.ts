import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
/** Works both in workspace CLIs and in Next's server bundle, without bundler-specific import URLs. */
export function repositoryRoot(): string {
  let root = process.env.AGENTFUND_ROOT ?? process.cwd();
  while (!existsSync(resolve(root, "contracts/cardano/plutus.json"))) {
    const parent = dirname(root);
    if (process.env.AGENTFUND_ROOT || parent === root) throw new Error("Set AGENTFUND_ROOT to the application repository containing contracts/cardano/plutus.json");
    root = parent;
  }
  return root;
}
