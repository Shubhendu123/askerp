// D-048 gates 1-2 (retrieval only, no LLM): corpus inventory + governed-retrieval behaviours. Run from repo root: npx tsx harborline/test_corpus_retrieval.ts
import fs from "fs"; import path from "path";
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf-8").split("\n")) { const m = line.match(/^([A-Za-z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
(async () => {
  const R = await import(path.join(process.cwd(), "lib/retrieval/retriever"));
  const all = await R.getTenantChunks("harborline");
  const ids = new Set<string>(); let dup = 0; for (const c of all) { if (ids.has(c.id)) dup++; ids.add(c.id); }
  const byType: Record<string, number> = {};
  const docs = new Set<string>(); const docType: Record<string, number> = {};
  for (const c of all) { byType[c.type] = (byType[c.type] ?? 0) + 1; const m = c.id.match(/^harborline:((?:POL|CA|MG|REG|EVT|INC)[A-Za-z0-9.@-]*)#/); if (m) docs.add(m[1]); }
  const full = await R.retrieveAll("harborline");
  for (const r of full.results) if (r.policy) { const k = r.policy.doc_type; docType[k] = (docType[k] ?? 0) + 1; }
  console.log(`harborline chunks: ${all.length} (${JSON.stringify(byType)}); duplicate ids: ${dup}; documents: ${docs.size}`);
  console.log("document chunks by doc_type:", JSON.stringify(docType));
  console.log("sample ids:", ["harborline:CA-001#2", "harborline:MG-IT@1.0#1", "harborline:MG-IT@2.0#1", "harborline:EVT-2630#1", "harborline:INC-EVT-2630#2", "harborline:POL-001#2"].map((i) => `${i}=${ids.has(i)}`).join(" "));
  const show = async (q: string, tenant = "harborline") => {
    const r = await R.retrieveWithRanker(q, 10, tenant, "rrf");
    const docs = r.results.filter((x: any) => x.policy).map((x: any) => `${x.policy.citation}${x.expanded ? "*" : ""}[${x.policy.doc_type},${x.policy.access_level}]`);
    console.log(`\nQ: ${q}\n   docs(${docs.length}): ${docs.join(", ") || "-"}`);
    return r;
  };
  const Qs = [
    "Did Eastgate Capital Partners meet its settlement SLA in September 2026?",
    "How much does Harborline owe Pinnacle for the missed rights issue?",
    "For Vantage's missed dividend option in Italy, what should have been applied?",
    "What was the client instruction cut-off for Italian trades in February 2026?",
    "What is the client instruction cut-off for Italian trades today?",
    "If Montclair had tendered in event 2706, would all its shares have been bought?",
    "Is Westmark's missed German takeover election (event 2751) still recoverable, and what do we owe?",
    "Has Kendal Prowse Securities been through remediation, and what was the outcome?",
    "Why does Eastgate carry so many Harborline-borne penalties?",
    "Which of Westmark's eligible reclaims breached its 90-day filing window?",
    "What is Redwood Asset Management's settlement rate?",
    "When do the UK and EU move to T+1?",
    "What is our overall settlement fail rate?",
  ];
  for (const q of Qs) await show(q);
  // leakage: client agreements retrieved for questions that do not name that client
  let leak = 0;
  for (const q of ["What is Redwood Asset Management's settlement rate?", "What is our overall settlement fail rate?", "Which clients have the most aged fails?", "What is Pinnacle's settlement rate?"]) {
    const r = await R.retrieveWithRanker(q, 10, "harborline", "rrf");
    const ca = r.results.filter((x: any) => x.policy?.doc_type === "client_agreement").map((x: any) => x.policy.entities.client);
    const bad = ca.filter((c: string) => !q.toLowerCase().includes(c.split(" ")[0].toLowerCase()));
    leak += bad.length; console.log(`leak check: "${q}" -> agreements ${JSON.stringify(ca)} out-of-scope ${bad.length}`);
  }
  console.log(`\nconfidential leakage (out-of-scope client_agreement chunks): ${leak}`);
  // post-SQL enrichment
  const en = await R.enrichDocuments("Which corporate action elections did we miss?", ["event_key", "client_name", "estimated_client_impact_usd"], [[2630, "Pinnacle Asset Management", 1], [2706, "Montclair Pension Fund", 1]], "harborline", []);
  console.log("enrichment (event_key 2630/2706 rows):", en.map((x: any) => x.policy.citation).join(", "));
  const mro = await R.retrieveWithRanker("What is DSO?", 10, "mro", "rrf"); console.log("mro doc chunks:", mro.results.filter((x: any) => x.policy).length);
  process.exit(dup ? 1 : 0);
})();
