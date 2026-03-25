#!/usr/bin/env -S npx tsx
// Fetch the seller-managed full slot details for a discovered placement.
// Canonical buyer-side details flow after seller card resolution.
//
// Usage: npx tsx fetch_slot_details_from_seller.mts \
//          --seller-a2a-url <https://...> \
//          --placement-tx-hash <0x...> \
//          --placement-index <n>
//
// Output: JSON with extracted slot details and the raw seller response.
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

type JsonRecord = Record<string, unknown>;

const { values } = parseArgs({
  options: {
    "seller-a2a-url": { type: "string" },
    "placement-tx-hash": { type: "string" },
    "placement-index": { type: "string" },
    "request-id": { type: "string" },
    "message-id": { type: "string" },
  },
});

if (!values["seller-a2a-url"] || !values["placement-tx-hash"] || !values["placement-index"]) {
  process.stderr.write(JSON.stringify({
    error: "--seller-a2a-url, --placement-tx-hash, and --placement-index are required",
  }) + "\n");
  process.exit(1);
}

const sellerA2aUrl = values["seller-a2a-url"];
const txHash = values["placement-tx-hash"];
const placementIndex = Number(values["placement-index"]);

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
  if (Array.isArray(value)) {
    for (const item of value) visitCandidates(item, out, seen);
    return;
  }
  const record = value as JsonRecord;
  out.push(record);
  for (const nested of Object.values(record)) visitCandidates(nested, out, seen);
}

function collectCandidates(value: unknown): JsonRecord[] {
  const out: JsonRecord[] = [];
  visitCandidates(value, out, new Set());
  return out;
}

function firstString(candidates: JsonRecord[], key: string): string | null {
  for (const candidate of candidates) {
    const value = candidate[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function firstNumber(candidates: JsonRecord[], key: string): number | null {
  for (const candidate of candidates) {
    const value = candidate[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

const requestBody = {
  jsonrpc: "2.0",
  id: values["request-id"] ?? `req-${randomUUID()}`,
  method: "message/send",
  params: {
    message: {
      messageId: values["message-id"] ?? randomUUID(),
      role: "user",
      parts: [{
        data: {
          skill: "get-slot-details",
          placement_tx_hash: txHash,
          placement_index: placementIndex,
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
    body: JSON.stringify(requestBody),
  });
  responseStatus = response.status;
  responseData = await response.json();
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: "failed to fetch slot details from seller",
    detail: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}

if (responseStatus >= 400) {
  process.stderr.write(JSON.stringify({
    error: "seller slot-details request failed",
    status: responseStatus,
    response: responseData,
  }) + "\n");
  process.exit(1);
}

const candidates = collectCandidates(responseData);
const slotDetails = {
  snippet_id: firstString(candidates, "snippet_id"),
  page_url: firstString(candidates, "page_url"),
  dimensions: firstString(candidates, "dimensions"),
  min_amount_per_1000:
    firstString(candidates, "min_amount_per_1000") ??
    firstString(candidates, "price_per_mille"),
  ad_position: firstNumber(candidates, "ad_position"),
  publication_mode: firstNumber(candidates, "publication_mode"),
  keyword_flags: firstString(candidates, "keyword_flags"),
  policy_text: firstString(candidates, "policy_text"),
};

console.log(JSON.stringify({
  ok: true,
  placement_id: `${txHash}:${placementIndex}`,
  slot_details: slotDetails,
  request: requestBody,
  response: responseData,
}));
