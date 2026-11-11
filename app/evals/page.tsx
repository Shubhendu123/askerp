import AppShell from "@/components/shell/AppShell";
import data from "@/evals/evals_data.json";

// D-049: every figure below is rendered from evals/evals_data.json, which benchmark/build_evals_data.py derives from
// committed result files (benchmark/runs_harborline/*.jsonl, benchmark/stability_d049.json) and DECISIONS.md. Nothing is typed in here.
import { getActiveTenantConfig } from "@/lib/tenants";
export function generateMetadata() { return { title: `${getActiveTenantConfig().productName} — Evals` }; }

type Tier = { mean: number; min: number; max: number; n_questions: number };
type AblationRow = Record<string, string | number>;
type StabilityRow = { question: string; verdict: string; rows_same: boolean; headline_same: boolean; outcomes: string[] | null; flags: string[]; http_500_non_refusal: number; n_runs: number; before?: { verdict: string; why: string; fix: string } };

const f2 = (x: number) => x.toFixed(2);
const range = (t: { mean: number; min: number; max: number }) => `${f2(t.mean)} [${f2(t.min)}–${f2(t.max)}]`;

const card = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md, 8px)" } as const;
const th = "text-left text-xs font-medium px-3 py-2";
const td = "px-3 py-2 text-sm align-top";

function verdictStyle(v: string) {
  if (v === "STABLE") return { background: "var(--sentiment-positive-bg)", color: "var(--sentiment-positive)" };
  if (v === "UNSTABLE" || v === "STABLE-FAIL") return { background: "var(--sentiment-negative-bg)", color: "var(--sentiment-negative)" };
  return { background: "var(--bg-subtle)", color: "var(--text-secondary)" };
}

export default function EvalsPage() {
  const h = data.headline;
  const ab = data.ablation.rows as AblationRow[];
  const stab = data.stability as StabilityRow[] | null;
  const problems = data.problems as { problem: string; fix: string; adr: string }[];
  const tiers = Object.entries(h.per_tier as Record<string, Tier>);

  return (
    <AppShell>
      <div className="p-6 max-w-5xl" style={{ color: "var(--text-primary)" }}>
        <h1 className="text-xl font-semibold mb-1">Evals — Harborline</h1>
        <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
          Rendered from committed result files and DECISIONS.md. A-score is 0–3 per question, scored against ground-truth SQL that was executed before any model run.
        </p>
        <p className="text-xs mb-6 -mt-4" style={{ color: "var(--text-tertiary)" }}>Offline snapshot from committed benchmark runs; updates on each benchmark run.</p>

        {/* Headline */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold mb-2">Headline A-score ({h.n_runs} runs, rrf / k=10) <span className="font-normal text-xs" style={{ color: "var(--text-tertiary)" }}>— measured before D-049</span></h2>
          <div className="grid gap-3 sm:grid-cols-3 mb-3">
            <div className="p-4" style={card}>
              <div className="text-3xl font-semibold">{f2(h.A_all.mean)}</div>
              <div className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>mean A over {h.n_answerable} answerable questions, range {f2(h.A_all.min)}–{f2(h.A_all.max)} across runs</div>
            </div>
            <div className="p-4" style={card}>
              <div className="text-3xl font-semibold">{h.valid_sql.mean.toFixed(0)}<span className="text-base font-normal"> / {h.n_answerable}</span></div>
              <div className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>valid SQL, range {h.valid_sql.min}–{h.valid_sql.max}</div>
            </div>
            <div className="p-4" style={card}>
              <div className="text-3xl font-semibold">{Math.min(...h.controls_passed)}<span className="text-base font-normal"> / 4</span></div>
              <div className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>decline-controls passed in every run</div>
            </div>
          </div>
          <div style={card} className="overflow-x-auto">
            <table className="w-full">
              <thead><tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                <th className={th}>Tier</th><th className={th}>Questions</th><th className={th}>Mean A [min–max]</th>
              </tr></thead>
              <tbody>
                {tiers.map(([name, t]) => (
                  <tr key={name} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className={td}>{name}</td><td className={td}>{t.n_questions}</td><td className={td}>{range(t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>Source: {h.files.join(", ")}</p>
        </section>

        {/* Ablation */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold mb-2">Retrieval-mode ablation (k=10)</h2>
          <div style={card} className="overflow-x-auto">
            <table className="w-full">
              <thead><tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                <th className={th}>Mode</th><th className={th}>Runs</th><th className={th}>Mean A [min–max]</th><th className={th}>Hybrid A</th><th className={th}>Tokens in / question</th><th className={th}>Relative cost</th>
              </tr></thead>
              <tbody>
                {ab.map((r) => (
                  <tr key={String(r.mode)} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className={`${td} font-medium`}>{r.mode}</td>
                    <td className={td}>{r.n}</td>
                    <td className={td}>{r["A all-26"]}</td>
                    <td className={td}>{r.hybrid}</td>
                    <td className={td}>{r["tokens in / question"]}</td>
                    <td className={td}>{Number(r.relative_cost).toFixed(2)}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>
            Differences inside the run-to-run range are ties. Relative cost = cost per run ÷ rrf cost per run. Source: {data.ablation.source}.
          </p>
        </section>

        {/* Stability */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold mb-2">Demo stability</h2>
          {!stab ? (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No stability results are committed yet.</p>
          ) : (
            <div style={card} className="overflow-x-auto">
              <table className="w-full">
                <thead><tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                  <th className={th}>Question</th><th className={th}>Runs</th><th className={th}>Same rows</th><th className={th}>Outcomes</th><th className={th}>Flags</th><th className={th}>Verdict</th><th className={th}>Change</th>
                </tr></thead>
                <tbody>
                  {stab.map((r) => (
                    <tr key={r.question} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td className={td}>{r.question}</td>
                      <td className={td}>{r.n_runs}</td>
                      <td className={td}>{r.rows_same ? "yes" : "no"}</td>
                      <td className={td}>{(r.outcomes ?? []).join(" · ")}</td>
                      <td className={td}>{r.flags.length ? r.flags.join("; ") : "none"}</td>
                      <td className={td}><span className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap" style={verdictStyle(r.verdict)}>{r.verdict}</span></td>
                      <td className={td} style={{ minWidth: "14rem" }}>
                        {r.before ? (
                          <span className="text-xs">
                            <span style={{ color: "var(--sentiment-negative)", fontWeight: 500 }}>{r.before.verdict}</span> ({r.before.why}) →{" "}
                            <span style={{ color: "var(--sentiment-positive)", fontWeight: 500 }}>{r.verdict}</span> after {r.before.fix}
                          </span>
                        ) : <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>–</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>
            STABLE = identical result rows in every run, no scope/fidelity/unit flag, and the same outcome every time (valid, or a deliberate decline). A consistent error is STABLE-FAIL. Wording of the narration is allowed to vary.
          </p>
        </section>

        {/* Problems */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold mb-2">Problems found and fixed</h2>
          <div style={card} className="overflow-x-auto">
            <table className="w-full">
              <thead><tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                <th className={th}>Problem</th><th className={th}>Fix</th><th className={th}>ADR</th>
              </tr></thead>
              <tbody>
                {problems.map((p) => (
                  <tr key={p.problem} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className={td}>{p.problem}</td><td className={td}>{p.fix}</td><td className={`${td} whitespace-nowrap`}>{p.adr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
