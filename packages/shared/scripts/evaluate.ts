import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildReport, ChainClient, renderReportMarkdown, scoreFacts, type Facts } from "../src/index.js";

const fixture = JSON.parse(readFileSync(new URL("../test/fixtures/quality-cases.json", import.meta.url), "utf8"));
const cases = fixture.cases.map((c: { id: string; facts: Omit<Facts, "balanceLovelace"> & { balanceLovelace: string }; expected: { verdict: string; risk: number; flags: string[] }; reason: string }) => {
  const score = scoreFacts({ ...c.facts, balanceLovelace: BigInt(c.facts.balanceLovelace) }, fixture.now);
  const actual = { verdict: score.verdict, risk: score.risk, flags: score.redFlags.map(f => f.code) };
  return { id: c.id, expected: c.expected, actual, passed: JSON.stringify(actual) === JSON.stringify(c.expected), reason: c.reason };
});
const dir = fileURLToPath(new URL("../../../docs/evidence/atlas-quality/", import.meta.url));
mkdirSync(dir, { recursive: true });
const summary = { generatedAt: new Date().toISOString(), scope: fixture.description, passed: cases.filter((c: { passed: boolean }) => c.passed).length, total: cases.length, cases };
writeFileSync(`${dir}/acceptance.json`, JSON.stringify(summary, null, 2) + "\n");
console.log(`Synthetic acceptance: ${summary.passed}/${summary.total} passed. This is not a fraud-accuracy measurement.`);
if (summary.passed !== summary.total) process.exitCode = 1;

if (process.argv.includes("--live")) {
  const key = process.env.BLOCKFROST_PROJECT_ID;
  if (!key) throw new Error("Set BLOCKFROST_PROJECT_ID locally to run read-only preprod evaluation.");
  const subjects = [
    { id: "registered-agent", address: "addr_test1qpmdzh7surd5r6kvanvcmg6wam6nn9n0ec5mp5v0t0dhtmzdfav2l3umddzyjsdjgc2vnrx3aj3y4t0d2r059njfvg7q5pwayf", registered: true, script: false },
    { id: "masumi-escrow", address: "addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g", registered: false, script: true },
    { id: "test-investor", address: "addr_test1qqwdk97gwef6ypkjcd9hhgpls8ela9fdvee2wvaxnkmjqdtj5pvye96gvjtm2jv70mtyqsczypsl8f2d3dgtlcmktk0sv74rjj", registered: false, script: false },
  ];
  const results = [];
  for (const subject of subjects) {
    const report = await buildReport(subject.address, { chain: new ChainClient({ blockfrostProjectId: key }) });
    const passed = Boolean(report.agent) === subject.registered && report.facts.isScript === subject.script && report.sources.length > 0;
    writeFileSync(`${dir}/${subject.id}.json`, JSON.stringify(report, null, 2) + "\n");
    writeFileSync(`${dir}/${subject.id}.md`, renderReportMarkdown(report));
    results.push({ id: subject.id, expected: { registered: subject.registered, script: subject.script }, passed, observed: { registered: Boolean(report.agent), script: report.facts.isScript, verdict: report.score.verdict, risk: report.score.risk, balanceStatus: report.assessment.balanceStatus, queries: report.sources.length } });
    console.log(`${subject.id}: identity/type ${passed ? "PASS" : "FAIL"}; balance ${report.assessment.balanceStatus}; ${report.score.verdict} signals (${report.score.risk}/100).`);
  }
  writeFileSync(`${dir}/live.json`, JSON.stringify({ generatedAt: new Date().toISOString(), scope: "Three known-role preprod addresses; checks role identification and records source agreement, not fraud prediction.", results }, null, 2) + "\n");
  if (results.some(r => !r.passed)) process.exitCode = 1;
}
