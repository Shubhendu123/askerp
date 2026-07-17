/**
 * D-035 verification: per-tenant retrieval isolation probes.
 * Runs 10 queries across both tenants and asserts ZERO cross-tenant chunks
 * in every result set. Run from repo root: npx tsx scripts/probe_tenant_isolation.ts
 */
import fs from "fs";
import path from "path";

// Load .env.local (VOYAGE_API_KEY) without adding a dotenv dependency
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

import { retrieve } from "../lib/retrieval/retriever";

const PROBES: Array<{ q: string; tenant: string }> = [
  { q: "total revenue", tenant: "mro" },
  { q: "total revenue", tenant: "northwind" },
  { q: "What is our furniture category margin?", tenant: "mro" },
  { q: "furniture sales for office seating", tenant: "mro" },
  { q: "What is our DSO?", tenant: "mro" },
  { q: "which suppliers deliver on time", tenant: "mro" },
  { q: "stockout rate", tenant: "mro" },
  { q: "cash conversion cycle", tenant: "mro" },
  { q: "customer churn", tenant: "northwind" },
  { q: "cancellation rate for office seating", tenant: "northwind" },
];

async function main() {
  let crossTenant = 0;
  for (const { q, tenant } of PROBES) {
    const resp = await retrieve(q, 5, tenant);
    const leaks = resp.results.filter((r) => !r.id.startsWith(`${tenant}:`));
    crossTenant += leaks.length;
    const status = leaks.length === 0 ? "PASS" : `FAIL (${leaks.map((l) => l.id).join(", ")})`;
    console.log(
      `[${tenant.padEnd(9)}] "${q}" -> ${resp.results.slice(0, 3).map((r) => r.id).join(", ")} | band=${resp.confidence.confidence_band} | ${status}`
    );
  }

  // Default-tenant path: no tenant arg, ACTIVE_TENANT unset in this run -> 'mro'
  const def = await retrieve("total revenue", 5);
  const defLeaks = def.results.filter((r) => !r.id.startsWith("mro:"));
  crossTenant += defLeaks.length;
  console.log(
    `[default  ] "total revenue" (no tenant arg, ACTIVE_TENANT unset) -> ${def.results[0].id} | ${defLeaks.length === 0 ? "PASS (defaulted to mro)" : "FAIL"}`
  );

  console.log(`\nTotal cross-tenant results across ${PROBES.length + 1} probes: ${crossTenant}`);
  process.exit(crossTenant === 0 ? 0 : 1);
}

main();
