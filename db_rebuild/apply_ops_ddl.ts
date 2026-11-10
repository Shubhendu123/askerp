// Applies db_rebuild/ddl/ops_request_traces.sql to the active backend (MotherDuck if MOTHERDUCK_TOKEN set, else local file).
import fs from "fs";
import { writeSQL, executeSQL } from "../lib/db";
(async () => {
  const ddl = fs.readFileSync("db_rebuild/ddl/ops_request_traces.sql", "utf8");
  for (const stmt of ddl.split(/;\s*$/m).map((x) => x.trim()).filter(Boolean)) await writeSQL(stmt, []);
  const r = await executeSQL("SELECT count(*) AS n FROM ops.request_traces");
  console.log(process.env.MOTHERDUCK_TOKEN ? "[MotherDuck]" : "[local file]", "ops.request_traces rows:", r.rows[0][0]);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
