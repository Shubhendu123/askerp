// D-045/D-046 Gate B: policy_refs expansion + 3-chunk cap, run through the real retriever (Voyage + BM25 + RRF).
import { retrieve } from "../lib/retrieval/retriever";
const show = async (q: string, label: string) => {
  const r = await retrieve(q, 10, "harborline", true);
  const pol = r.results.filter((x) => x.type === "policy");
  console.log(`\n[${label}] ${q}`);
  console.log("  ranked  :", r.results.filter((x) => !x.expanded).map((x) => `${x.id.replace("harborline:", "")}(${x.type[0]})`).join(", "));
  console.log("  expanded:", r.results.filter((x) => x.expanded).map((x) => x.id.replace("harborline:", "")).join(", ") || "-");
  console.log(`  policy chunks: ${pol.length} (cap ${process.env.RETRIEVAL_MAX_POLICY_CHUNKS ?? 3}) total chunks: ${r.results.length}`);
  return r;
};
(async () => {
  console.log("== EXPANSION: metric -> policy_refs ==");
  const a = await show("How many aged fails do we have?", "aged_fails_count refs POL-006#3, POL-001#2");
  const b = await show("Which clients are unprofitable under our cost-to-serve definition?", "client_profitability_usd refs POL-010#6");
  const c = await show("What percentage of income arrives on time?", "income_on_time_pct refs POL-008#3");
  for (const [r, id] of [[a, "POL-006#3"], [a, "POL-001#2"], [b, "POL-010#6"], [c, "POL-008#3"]] as const)
    console.log(`  ${id} present: ${r.results.some((x) => x.id === "harborline:" + id)}  via expansion: ${r.results.some((x) => x.id === "harborline:" + id && x.expanded)}`);
  console.log("\n== CAP: question matching many policy sections ==");
  const Q = "What do our policies say about settlement fails, penalties, escalation thresholds, SLA tiers, counterparty tiers, overdrafts and reclaim rules?";
  process.env.RETRIEVAL_MAX_POLICY_CHUNKS = "100";
  const un = await show(Q, "UNCAPPED (control)");
  delete process.env.RETRIEVAL_MAX_POLICY_CHUNKS;
  const cp = await show(Q, "default cap");
  const nonPolUn = un.results.filter((x) => x.type !== "policy").length, nonPol = cp.results.filter((x) => x.type !== "policy").length;
  console.log(`\n  cap holds (<=3 policy): ${cp.results.filter((x) => x.type === "policy").length <= 3} | non-policy chunks kept: capped ${nonPol} vs uncapped ${nonPolUn}`);
  process.env.RETRIEVAL_MAX_POLICY_CHUNKS = "1";
  const one = await show("How many aged fails do we have?", "cap=1 with expansion (ranked+expanded combined)");
  console.log("  combined cap holds (<=1):", one.results.filter((x) => x.type === "policy").length <= 1);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
