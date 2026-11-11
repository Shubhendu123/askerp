// D-050: display-only SQL pretty-printer for the "Show SQL" panel (Harborline). It only changes whitespace outside string
// literals and drops `--` comments; the executed SQL is never touched. Unit-tested: stripping all whitespace from the input
// and the output gives the same text (harborline/test_value_format.ts).

const TOKEN = /'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\s+|[(),]|[^\s(),'"]+/g;
const CLAUSES = new Set(["SELECT", "FROM", "WHERE", "HAVING", "LIMIT", "UNION", "WITH", "QUALIFY", "WINDOW"]);
const JOIN_MODS = new Set(["INNER", "FULL", "CROSS", "NATURAL", "OUTER", "LEFT", "RIGHT"]);

export function formatSql(sql: string): string {
  const toks: string[] = [];
  for (const m of Array.from(sql.replace(/;\s*$/, "").matchAll(TOKEN))) {
    const t = m[0];
    if (t.startsWith("--")) continue;
    toks.push(/^\s+$/.test(t) ? " " : t);
  }
  const sig = toks.map((t, i) => [t, i] as const).filter(([t]) => t !== " ");
  const nextSig = (i: number) => sig.find(([, j]) => j > i)?.[0]?.toUpperCase();

  // A word is a JOIN modifier (LEFT / RIGHT / INNER / FULL / OUTER / CROSS / NATURAL) when it is followed by JOIN or another modifier;
  // that keeps the string functions LEFT(...) / RIGHT(...) out of it.
  const joinMod = new Set<number>();
  sig.forEach(([t, i]) => { const u = t.toUpperCase(); const n = nextSig(i); if (JOIN_MODS.has(u) && (n === "JOIN" || (n !== undefined && JOIN_MODS.has(n)))) joinMod.add(i); });
  const prevIdx = (i: number) => [...sig].reverse().find(([, j]) => j < i)?.[1] ?? -1;

  let out = "", indent = 0, clause = "", between = false;
  const stack: { sub: boolean; clause: string }[] = [];
  const atClause = () => stack.length === 0 || stack[stack.length - 1].sub;
  const nl = (extra = 0) => { out = out.replace(/[ ]+$/, ""); if (out && !out.endsWith("\n")) out += "\n"; out += "  ".repeat(indent + extra); };

  toks.forEach((t, i) => {
    const u = t.toUpperCase();
    if (t === " ") { if (out && !/[\s(]$/.test(out)) out += " "; return; }
    if (t === "(") {
      const sub = ["SELECT", "WITH"].includes(nextSig(i) ?? "");
      stack.push({ sub, clause });
      out += "(";
      if (sub) { indent++; nl(); clause = ""; }
      return;
    }
    if (t === ")") {
      const top = stack.pop();
      if (top?.sub) { indent--; nl(); }
      out += ")";
      clause = top?.clause ?? clause;
      return;
    }
    if (t === ",") {
      out += ",";
      if (atClause() && clause === "SELECT") nl(1);
      else if (atClause() && clause === "WITH") nl();
      return;
    }
    if (atClause()) {
      const nxt = nextSig(i);
      if (CLAUSES.has(u)) {
        if (u === "UNION" || out) nl(); // (a UNION starts its own line; ALL follows on the same line)
        out += t; clause = u;
        if (u === "SELECT") nl(1);
        return;
      }
      if ((u === "GROUP" || u === "ORDER") && nxt === "BY") { nl(); out += t; clause = u; return; }
      if ((u === "JOIN" || joinMod.has(i)) && !joinMod.has(prevIdx(i))) { nl(); out += t; clause = "JOIN"; return; }
      if (u === "BETWEEN") between = true;
      if ((u === "AND" || u === "OR") && (clause === "WHERE" || clause === "HAVING")) {
        if (u === "AND" && between) between = false;
        else { nl(1); out += t; return; }
      }
    }
    out += t;
  });
  return out.trim();
}
