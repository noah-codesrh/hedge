#!/usr/bin/env node
"use strict";
/**
 * button.fun · Proof-of-Build — Cursor hooks reporter.
 *
 * The Cursor parallel to .claude/hooks/pob-usage.js. Cursor's hooks do NOT expose provider token
 * counts (unlike Claude Code's transcript), so this ESTIMATES usage from the text Cursor does hand
 * the hooks — the prompt + attached files (input) and the thinking + response (output) — using a
 * ~4-chars-per-token heuristic. It accumulates per conversation and POSTs the new counts to
 * button.fun at each turn end, so your token burns in proportion to real building.
 *
 * COUNTS ONLY — it derives integer token estimates and sends those; it never transmits your
 * prompts, code, thinking, or responses. Dependency-free; always exits 0 so it can't block Cursor.
 *
 * Register in .cursor/hooks.json for these events, all pointing at this script:
 *   beforeSubmitPrompt · afterAgentThought · afterAgentResponse · stop · sessionEnd
 * (this script switches on the event name it receives on stdin).
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");

const SUBJECT = (process.env.POB_SUBJECT || "").trim();
const INGEST_URL = (process.env.POB_INGEST_URL || "https://button.fun/v1/pob/ingest").trim();
const INGEST_TOKEN = (process.env.POB_INGEST_TOKEN || "").trim();
const STATE = path.join(os.homedir(), ".cursor", ".pob-hook-state.json");
const MAX_ATTACH_BYTES = 262144; // cap per attached file when estimating input context

// ~4 chars/token — the standard provider-agnostic rule of thumb. This is an ESTIMATE: Cursor
// exposes no real token counts, and button.fun's burn rate is tuned to absorb the approximation.
function est(s) { return typeof s === "string" && s.length ? Math.ceil(s.length / 4) : 0; }

let hook = {};
try { hook = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch {}
const ev = hook.hook_event_name || "";
const session = hook.conversation_id || hook.session_id || "session";
if (!SUBJECT) process.exit(0);

let state = {};
try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch {}
const p = state[session] || { input: 0, output: 0 };
function save() {
  try {
    fs.mkdirSync(path.dirname(STATE), { recursive: true }); // ~/.cursor may not exist yet
    state[session] = p;
    fs.writeFileSync(STATE, JSON.stringify(state));
  } catch {}
}

// ---- accumulate: input from the prompt (+ attached files), output from thinking + response ----
if (ev === "beforeSubmitPrompt") {
  p.input += est(hook.prompt);
  const att = Array.isArray(hook.attachments) ? hook.attachments : [];
  for (const a of att) {
    if (a && a.type === "file" && typeof a.file_path === "string") {
      try {
        const st = fs.statSync(a.file_path);
        if (st.isFile() && st.size <= MAX_ATTACH_BYTES) p.input += est(fs.readFileSync(a.file_path, "utf8"));
      } catch {}
    }
  }
  save(); process.exit(0);
}
if (ev === "afterAgentThought") { p.output += est(hook.text); save(); process.exit(0); }
if (ev === "afterAgentResponse") { p.output += est(hook.text); save(); process.exit(0); }

// ---- flush: at each turn end (stop) or session end, POST the accumulated counts ----
if (ev !== "stop" && ev !== "sessionEnd") process.exit(0);
const dIn = Math.max(0, Math.trunc(p.input));
const dOut = Math.max(0, Math.trunc(p.output));
if (dIn + dOut === 0) process.exit(0);

// Claim the pending amount BEFORE sending: reset the accumulator now, so a duplicate stop/sessionEnd
// (or a retry) can never re-send the same counts. At-most-once by design — on a network blip we drop
// this batch rather than risk double-burning. It's an estimate feeding a tunable rate anyway.
p.input = 0; p.output = 0; save();

const body = JSON.stringify({ subject: SUBJECT, usage: { input_tokens: dIn, output_tokens: dOut } });
let url; try { url = new URL(INGEST_URL); } catch { process.exit(0); }
const lib = url.protocol === "http:" ? http : https;
const headers = { "content-type": "application/json", "content-length": Buffer.byteLength(body) };
if (INGEST_TOKEN) headers.authorization = "Bearer " + INGEST_TOKEN;

const req = lib.request(
  {
    hostname: url.hostname,
    port: url.port || (url.protocol === "http:" ? 80 : 443),
    path: (url.pathname || "/") + (url.search || ""),
    method: "POST",
    headers,
  },
  (res) => {
    res.on("data", () => {});
    res.on("end", () => process.exit(0)); // already claimed above; nothing to persist here
  },
);
req.on("error", () => process.exit(0));
req.setTimeout(10000, () => { try { req.destroy(); } catch {} process.exit(0); });
req.write(body);
req.end();
