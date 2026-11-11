// LOCAL TEST SHIM (not product code). Accepts Anthropic Messages API requests and answers them with
// `claude -p` on the user's subscription login. Used only for local test runs via ANTHROPIC_BASE_URL.
//   node tools/llm-shim/server.mjs [port]      (default 8787)
// The request's system prompt REPLACES Claude Code's system prompt; all tools are disabled.
// The child process gets NO ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL, so it can never hit the metered API
// or loop back into this shim. Nothing here prints or stores credentials.
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.argv[2] ?? process.env.SHIM_PORT ?? 8787);
const CWD = mkdtempSync(join(tmpdir(), "llm-shim-")); // empty dir: no CLAUDE.md / project settings picked up
const MAX_PARALLEL = Number(process.env.SHIM_PARALLEL ?? 2);
let active = 0;
const waiters = [];
const acquire = () => (active < MAX_PARALLEL ? (active++, Promise.resolve()) : new Promise((r) => waiters.push(r)));
const release = () => { const n = waiters.shift(); if (n) n(); else active--; };

const text = (c) => (typeof c === "string" ? c : (c ?? []).map((b) => (b.type === "text" ? b.text : "")).join(""));

function runClaude(model, system, prompt) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; delete env.ANTHROPIC_BASE_URL;
    env.MAX_THINKING_TOKENS = "0"; // the app's real API calls use no extended thinking; keep the shim equivalent (and fast)
    const args = [
      "-p", "--model", model, "--system-prompt", system || "You are a helpful assistant.",
      "--tools", "", "--disable-slash-commands", "--strict-mcp-config", "--setting-sources", "",
      "--no-session-persistence", "--effort", "low", "--output-format", "json",
    ];
    const p = spawn("claude", args, { cwd: CWD, env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      try {
        const j = JSON.parse(out);
        if (j.is_error || code !== 0) return reject(new Error(String(j.result ?? err).slice(0, 300)));
        resolve(j);
      } catch { reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 300)}`)); }
    });
    p.stdin.end(prompt);
  });
}

http.createServer(async (req, res) => {
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) return send(404, { type: "error", error: { type: "not_found_error", message: "shim: only POST /v1/messages" } });
  let body = ""; for await (const c of req) body += c;
  let r; try { r = JSON.parse(body); } catch { return send(400, { type: "error", error: { type: "invalid_request_error", message: "bad json" } }); }
  const prompt = (r.messages ?? []).map((m) => text(m.content)).join("\n\n");
  await acquire();
  try {
    const j = await runClaude(r.model, text(r.system), prompt);
    const u = j.usage ?? {};
    send(200, {
      id: "msg_shim_" + Date.now(), type: "message", role: "assistant", model: r.model,
      content: [{ type: "text", text: String(j.result ?? "") }], stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output_tokens: u.output_tokens ?? 0 },
    });
  } catch (e) {
    // Surface as a 529-like error so the app/runners treat it as an infrastructure failure, never as an answer.
    send(529, { type: "error", error: { type: "overloaded_error", message: "shim: " + (e instanceof Error ? e.message : String(e)) } });
  } finally { release(); }
}).listen(PORT, "127.0.0.1", () => console.log(`llm-shim listening on http://127.0.0.1:${PORT} (cwd ${CWD})`));
