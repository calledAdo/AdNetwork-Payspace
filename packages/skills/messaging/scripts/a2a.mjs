#!/usr/bin/env node
// Generic JSON-RPC A2A sender template.
//
// This is intentionally skill-agnostic: it crafts `message/send` with a target
// `skill` plus arbitrary payload data provided by the caller.
//
// CLI supports:
// - payload as a single JSON object via `--data`
// - payload as separate `--kv key=value` parameters
// - mixture of both: `--data` parsed first, then `--kv` overwrites/extends
//
// Usage:
//   node a2a.mjs --a2a-url <https://...> --skill <skill-id> \
//     --data '{"placement_tx_hash":"0x...","placement_index":0}' \
//     --kv correlationId=ctx_123
//
// Output:
//   { ok: true, status, request, response }
import { randomUUID } from "node:crypto";

function parseArgs(argv) {
  const args = new Map();
  const kvPairs = [];

  // Very small custom parser:
  // - recognizes `--key value` pairs
  // - recognizes repeated `--kv key=value`
  // - leaves unknown flags ignored (by design)
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) continue;
    const key = tok.slice(2);

    if (key === "kv") {
      const v = argv[++i];
      if (v && typeof v === "string" && v.includes("=")) kvPairs.push(v);
      continue;
    }

    const v = argv[++i];
    if (v === undefined) continue;
    args.set(key, v);
  }
  return { args, kvPairs };
}

function safeJsonParse(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try { return JSON.parse(trimmed); } catch { return undefined; }
}

function parseKvPair(pair) {
  const idx = pair.indexOf("=");
  const k = pair.slice(0, idx).trim();
  const v = pair.slice(idx + 1).trim();
  return { k, v };
}

const { args, kvPairs } = parseArgs(process.argv);

const a2aUrl =
  args.get("a2a-url") ??
  args.get("seller-a2a-url") ??
  args.get("url") ??
  args.get("to");

const targetSkill = args.get("skill") ?? args.get("target-skill");
const contextId = args.get("context-id");
const role = args.get("role") ?? "user";

if (!a2aUrl) {
  process.stderr.write(JSON.stringify({ error: "--a2a-url is required" }) + "\n");
  process.exit(1);
}
if (!targetSkill) {
  process.stderr.write(JSON.stringify({ error: "--skill is required" }) + "\n");
  process.exit(1);
}

const requestId = args.get("request-id") ?? `req-${randomUUID()}`;
const messageId = args.get("message-id") ?? randomUUID();

const dataFromJson = safeJsonParse(args.get("data")) ?? {};
const data = typeof dataFromJson === "object" && dataFromJson !== null ? dataFromJson : {};

// Merge `--kv` pairs as strings. (Caller controls types by embedding them in `--data` JSON.)
for (const pair of kvPairs) {
  const { k, v } = parseKvPair(pair);
  if (k) data[k] = v;
}

// Ensure the top-level `skill` routing field exists in the payload.
data.skill = targetSkill;

const requestBody = {
  jsonrpc: "2.0",
  id: requestId,
  method: "message/send",
  params: {
    message: {
      messageId,
      ...(contextId ? { contextId } : {}),
      role,
      parts: [{
        data,
        mediaType: "application/json",
      }],
    },
  },
};

let responseStatus = 0;
let responseData;
try {
  const response = await fetch(a2aUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  responseStatus = response.status;
  responseData = await response.json().catch(() => null);
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: "A2A request failed",
    detail: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  status: responseStatus,
  request: requestBody,
  response: responseData,
}));

