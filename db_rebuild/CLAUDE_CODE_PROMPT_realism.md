# Claude Code Prompt — Realism polish: names + demo credibility pass (D-038)

## Objective
Remove every "toy project" tell a hiring manager would spot in 30 seconds. Two workstreams:
(A) real-looking entity names, (B) demo-credibility details in output and UI.
No schema changes, no key changes, no metric changes, no benchmark invalidation.

## Read first
DECISIONS.md D-029..D-037. All joins run on numeric keys; names are pure labels — this task
must keep it that way.

---

## PART A — Entity naming (data)

### A1. Name inventory (deterministic, seeded)
Build name lists INTO the generator (db_rebuild/gen/generate_mro_v2.py) so regeneration
reproduces them (extend the dedicated RNG-stream pattern from D-034 — main stream untouched).
Then apply to the live data via UPDATEs on dimension tables (local + cloud).

- **Suppliers (100)** — MRO-industry flavored, region-consistent with dim_supplier.region:
  US/Canada regions get names like "Apex Fastener Supply", "Great Lakes Industrial Co.",
  "Lonestar Abrasives", "Keystone Safety Products", "Gulf Coast Electrical Supply".
  Import-APAC: "Shenzhen Precision Hardware", "Taichung Tool Works", "Osaka Industrial Trading".
  Import-EU: "Rheinland Werkzeuge GmbH", "Brescia Utensili S.r.l.", "Nordfast AB".
  Suffix variety (Co., Inc., Supply, Industrial, GmbH, Ltd.) — no two identical, no numbering.
- **Customers (200)** — segment-flavored per dim_customer.segment:
  Manufacturing: "Meridian Assembly Works", "Vulcan Metal Fabrication";
  Construction: "TriState Mechanical Contractors", "Summit Builders Group";
  Facilities: "Northgate Property Services", "Cascade Facilities Management";
  Government: "Harris County Public Works", "Lakewood Municipal Utilities".
- **Employees (30)** — ordinary full names, diverse, no celebrities.
- **Warehouse names** stay as-is (already realistic: "Chicago DC" etc.).
- Do NOT rename Northwind entities (separate tenant, out of scope).

### A2. Apply + parity
1. UPDATE dim_supplier / dim_customer / dim_employee names in local data/northwind.db.
2. Re-upload ONLY those 3 tables to MotherDuck (CREATE OR REPLACE TABLE ... AS SELECT ...
   pattern from D-034). Token is in the environment — never print it.
3. Parity gate (plain terminal): row counts + a name-join spot check local vs cloud
   (e.g. top-5 suppliers by spend must show identical names both sides).

### A3. Downstream truth sweep
- ground_truth.json: find every stored answer containing old-style names ("Supplier 021",
  "Customer 103", "Employee 07") and remap via key -> new name. Re-run those ground-truth
  SQLs to confirm the stored expected values still match. Do NOT touch scores/results.jsonl
  (historical record — note in ADR that pre-D-038 artifacts carry old labels).
- benchmark/REPORT.md: leave as historical record; add a one-line footnote pointing at D-038.
- Corpus check: if any metrics.yaml/schema.yaml text or few-shot examples in the SQL
  generator embed old-style names, update them.

---

## PART B — Demo credibility pass (output + UI)

Only items below; do not redesign the UI.

### B1. Narrator voice
Inspect the narrator agent's current prompt/output on 3 test questions. Fix any of these
toy-tells if present (system-prompt-level changes only):
- Currency formatting: "$69,129,229.98" -> "$69.1M" in prose (tables may keep full figures).
- Percentages to 1 decimal; days to whole numbers in prose.
- Ban phrases that break the fiction: "synthetic data", "in this dataset", "the data shows
  that supplier_key...", raw column names in prose (order_to_ship_days -> "order-to-ship time").
- Narration should read like an analyst wrote it for a CFO — short, business-first.
- CLAIM PRECISION: quantified headlines must match the segment they describe. Example of the
  current failure: "43 late suppliers receive faster payment" where 43 is merely the row
  count including barely-late B-tier; the sharp claim is about the C/D tail ("12 C/D-tier
  suppliers average 7+ late days yet are paid ~7 days faster than company DPO"). Add a
  narrator rule: headline numbers must be recomputable from the segment named in the sentence.
- If a result column is constant across all rows (e.g. OVERALL DPO repeating 39.24), the
  narrator should state it once in prose; add a display rule to drop constant columns from
  the rendered table if the table renderer supports it cheaply — otherwise note in ADR as
  phase-5 SQL-shaping work.

### B2. Company identity — TENANT-AWARE (this is a bug fix, not polish)
The live UI currently says "Ask anything about Northwind Furniture" and
"ANALYSIS · NORTHWIND FURNITURE" while serving MRO data — the shell contradicts the backend.
Fix properly: introduce a per-tenant display config (e.g. lib/tenants.ts:
{ mro: { company: "Summit Industrial Supply Co.", tagline: ... }, northwind: {...} }) and
make every user-visible tenant string (search placeholder, analysis label, header/subtitle,
warehouse-stats card label) read from it via ACTIVE_TENANT. Do NOT find-and-replace strings —
the Northwind tenant must still render correctly if ACTIVE_TENANT is switched back.
MRO operating company: **"Summit Industrial Supply Co."** Do not build tenant-switching UI.

### B3. Micro-trust details (only if trivially cheap in current UI)
- Warehouse-stats card: ensure it now reflects MRO numbers (20 tables / 26 metrics / row
  count), not Northwind's.
- If the UI displays a data-freshness or "as of" label anywhere, make it show the warehouse's
  max date (data horizon), not wall-clock today (which would imply live data it doesn't have).
- If none of these slots exist, skip — do not add new UI surface for them.

### B4. Presentation formatting (small, high-visibility)
- Duration display: render human-readable ("28s", "1.4s"), never raw "27546ms".
- Result titles: fix acronym casing in generated titles — PO, DPO, DSO, DIO, CCC, OTIF, GL,
  AR must stay uppercase; avoid mangled Title Case like "Avg Po Late Days By Supplier, Dpo
  Days" -> "Avg PO Late Days by Supplier (DPO)". Implement as a title-formatting pass with
  an acronym whitelist, not hand-fixed strings.
- Note (do not fix here, log in ADR): first live query showed 27.5s end-to-end — likely
  serverless cold start (connection + corpus embedding on first hit). Record as a phase-6
  observability question: measure cold vs warm split; consider embedding-cache or keep-warm
  later. Out of scope now.

---

## Gates
1. Zero remaining /Supplier [0-9]{3}/, /Customer [0-9]{3}/, /Employee [0-9]{2}/ matches in
   dim tables (local + cloud), corpus files, SQL-generator prompts.
2. Parity spot-check passes (A2.3).
3. ground_truth.json remapped entries re-verified by executing their SQL.
4. Live smoke: M08 on production returns a real supplier NAME with correct spend; one
   narrator answer pasted showing B1 voice rules applied.
4b. Live UI shows zero "Northwind" strings while ACTIVE_TENANT=mro (placeholder, analysis
   label, headers) — and a local render with ACTIVE_TENANT=northwind still shows Northwind
   correctly (tenant config, not string replace).
4c. A generated title containing PO/DPO renders with correct acronym casing; duration shows
   human-readable format.
5. npx tsc --noEmit clean if any TS touched.

## ADR D-038
Cosmetic realism pass: naming scheme + region/segment consistency, keys untouched,
deterministic regeneration preserved, ground-truth remap, narrator voice rules (incl. claim
precision + constant-column handling), tenant-aware display config with company identity
("Summit Industrial Supply Co."), title/duration formatting, pre-D-038 benchmark artifacts
keep old labels (historical), cold-start latency question logged for phase 6.

## Working style
Plain-terminal verification; brief; pause only if a gate fails. Commit:
"feat: realism pass — entity names + narrator voice + demo identity (D-038)". Push allowed
after all gates pass (this is a production-visible fix). No other scope.
