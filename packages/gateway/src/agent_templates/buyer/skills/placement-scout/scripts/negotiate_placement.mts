#!/usr/bin/env -S npx tsx
// Send the first buyer->seller negotiation request for a placement and return
// the parsed negotiation result plus the raw A2A response.
//
// Usage: npx tsx negotiate_placement.mts \
//          --seller-a2a-url <https://...> \
//          --placement-tx-hash <0x...> \
//          --placement-index <n> \
//          --offered-price <udt_per_mille> \
//          --campaign-duration-days <days> \
//          --buyer-pubkey <0x...> \
//          --buyer-blake160 <0x...> \
//          --buyer-a2a-url <https://...> \
//          --correlation-id <buyer_nonce_...>
//
// Output: JSON with extracted context_id / agreed / pricing fields and raw response.
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

type JsonRecord = Record<string, unknown>;

const { values } = parseArgs({
  options: {
    "seller-a2a-url": { type: "string" },
    "placement-tx-hash": { type: "string" },
    "placement-index": { type: "string" },
    "offered-price": { type: "string" },
    "campaign-duration-days": { type: "string" },
    "buyer-pubkey": { type: "string" },
    "buyer-blake160": { type: "string" },
    "buyer-a2a-url": { type: "string" },
    "correlation-id": { type: "string" },
    "request-id": { type: "string" },
    "message-id": { type: "string" },
  },
});

const required = [
  "seller-a2a-url",
  "placement-tx-hash",
  "placement-index",
  "offered-price",
  "campaign-duration-days",
  "buyer-pubkey",
  "buyer-blake160",
  "buyer-a2a-url",
  "correlation-id",
] as const;

for (const key of required) {
  if (!values[key]) {
    process.stderr.write(JSON.stringify({ error: `--${key} is required` }) + "\n");
    process.exit(1);
  }
}

const sellerA2aUrl = values["seller-a2a-url"]!;

function parseJsonString(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function visitCandidates(value: unknown, out: JsonRecord[], seen: Set<unknown>): void {
  if (!value || seen.has(value)) return;
  if (typeof value === "string") {
    const parsed = parseJsonString(value);
    if (parsed !== value) visitCandidates(parsed, out, seen);
    return;
  }
  if (typeof value !== "object") return;

  seen.add(value);

  if (!Array.isArray(value)) {
    const record = value as JsonRecord;
    out.push(record);
    for (const nested of Object.values(record)) visitCandidates(nested, out, seen);
    return;
  }

  for (const item of value) visitCandidates(item, out, seen);
}

function collectCandidates(value: unknown): JsonRecord[] {
  const out: JsonRecord[] = [];
  visitCandidates(value, out, new Set());
  return out;
}

function extractString(candidates: JsonRecord[], key: string): string | null {
  for (const candidate of candidates) {
    const value = candidate[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function extractBoolean(candidates: JsonRecord[], key: string): boolean | null {
  for (const candidate of candidates) {
    const value = candidate[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

const body = {
  jsonrpc: "2.0",
  id: values["request-id"] ?? `req-${randomUUID()}`,
  method: "message/send",
  params: {
    message: {
      messageId: values["message-id"] ?? randomUUID(),
      role: "user",
      parts: [{
        data: {
          skill: "negotiate-placement",
          placement_tx_hash: values["placement-tx-hash"],
          placement_index: Number(values["placement-index"]),
          offered_price_per_mille: values["offered-price"],
          campaign_duration_days: Number(values["campaign-duration-days"]),
          buyer_pubkey: values["buyer-pubkey"],
          buyer_blake160: values["buyer-blake160"],
          buyer_a2a_url: values["buyer-a2a-url"],
          correlationId: values["correlation-id"],
        },
        mediaType: "application/json",
      }],
    },
  },
};

let responseData: unknown;
let responseStatus = 0;
try {
  const response = await fetch(sellerA2aUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  responseStatus = response.status;
  responseData = await response.json();
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: "failed to reach seller A2A endpoint",
    detail: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}

const candidates = collectCandidates(responseData);
const contextId =
  extractString(candidates, "contextId") ??
  extractString(candidates, "context_id");
const finalPrice =
  extractString(candidates, "final_price_per_mille") ??
  extractString(candidates, "finalPricePerMille");
const counterPrice =
  extractString(candidates, "counter_price") ??
  extractString(candidates, "counterPrice");
const reason = extractString(candidates, "reason");
const agreed = extractBoolean(candidates, "agreed");

if (responseStatus >= 400) {
  process.stderr.write(JSON.stringify({
    error: "seller negotiation request failed",
    status: responseStatus,
    response: responseData,
  }) + "\n");
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  context_id: contextId,
  agreed,
  final_price_per_mille: finalPrice,
  counter_price: counterPrice,
  reason,
  request: body,
  response: responseData,
}));
