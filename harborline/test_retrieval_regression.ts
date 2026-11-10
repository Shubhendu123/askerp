// D-048 regression (model-free): retrieval for the original 30 questions vs the stored D-047 run (rrf, k=10). Reports every difference.
import fs from "fs"; import path from "path";
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf-8").split("\n")) { const m = line.match(/^([A-Za-z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
(async () => {
  const R = await import(path.join(process.cwd(), "lib/retrieval/retriever"));
  const f = fs.readdirSync("benchmark/runs_harborline").find((x) => x.startsWith("harborline_d048_run1_"))!;
  const base = Object.fromEntries(fs.readFileSync(`benchmark/runs_harborline/${f}`, "utf-8").split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
  let same = 0, diff = 0;
  for (const id of Object.keys(base)) {
    const r = await R.retrieveWithRanker(base[id].question, 10, "harborline", "rrf");
    const now: string[] = r.results.map((x: any) => x.id), then: string[] = base[id].retrieved_chunk_ids;
    const a = new Set(now), b = new Set(then);
    const add = now.filter((x) => !b.has(x)), rem = then.filter((x) => !a.has(x));
    if (!add.length && !rem.length) same++; else { diff++; console.log(`${id}: +[${add.join(", ")}] -[${rem.join(", ")}]`); }
  }
  console.log(`\nretrieved id sets identical to D-047 run 1: ${same}/${same + diff}`);
  process.exit(0);
})();
