// D-048 gate 3 (model-free part): required-document coverage + confidential leakage over the 12 DOC questions and the 30 original ones.
import fs from "fs"; import path from "path";
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf-8").split("\n")) { const m = line.match(/^([A-Za-z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
(async () => {
  const R = await import(path.join(process.cwd(), "lib/retrieval/retriever"));
  const cfg = JSON.parse(fs.readFileSync("benchmark/questions_harborline.json", "utf-8"));
  const AGR: Record<string, string> = {};
  for (const f of fs.readdirSync("harborline/corpus/client_agreements")) { const t = fs.readFileSync(`harborline/corpus/client_agreements/${f}`, "utf-8"); AGR[t.match(/doc_id: (\S+)/)![1]] = t.match(/client: "([^"]+)"/)![1]; }
  let leak = 0, covSum = 0, covN = 0;
  console.log("id   doc_cov  retrieved docs (* = linked/expanded)");
  for (const q of cfg.questions) {
    if (q.tier === "C") continue;
    const r = await R.retrieveWithRanker(q.question, 10, "harborline", "rrf");
    const ids: string[] = r.results.map((x: any) => x.id);
    const req: string[] = [...(q.expected?.policies ?? []), ...(q.expected?.documents ?? [])];
    for (const id of ids) { const m = id.match(/^harborline:(CA-\d+)#/); if (m && !q.question.toLowerCase().includes(AGR[m[1]].split(" ")[0].toLowerCase())) { leak++; console.log("  LEAK", q.id, id); } }
    if (q.tier === "DOC") {
      const hit = req.filter((x) => ids.includes(x)); const cov = req.length ? hit.length / req.length : 1; covSum += cov; covN++;
      console.log(`${q.id}  ${cov.toFixed(2)}     ${r.results.filter((x: any) => x.policy).map((x: any) => x.policy.citation + (x.expanded ? "*" : "")).join(", ") || "-"}${hit.length < req.length ? "   MISSING: " + req.filter((x) => !ids.includes(x)).join(",") : ""}`);
    }
  }
  console.log(`\nDOC-tier required-document coverage (retrieval only): ${(covSum / covN).toFixed(2)} over ${covN} questions`);
  console.log(`confidential leakage over all ${cfg.questions.filter((q: any) => q.tier !== "C").length} non-control questions: ${leak}`);
  process.exit(0);
})();
