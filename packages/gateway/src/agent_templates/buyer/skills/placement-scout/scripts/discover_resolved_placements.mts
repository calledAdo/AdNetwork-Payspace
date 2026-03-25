#!/usr/bin/env -S npx tsx
// Canonical buyer discovery helper.
// It combines:
//   1. discover_placements.mts
//   2. resolve_seller_endpoint.mts
//
// Lower-level helpers still exist for reuse, but normal buyer flow should call
// this script first.
//
// Usage: npx tsx discover_resolved_placements.mts \
//          [--keyword-flags <uint32>] \
//          [--max-price     <udt_per_mille>] \
//          [--ad-position   <0|1|2|3>] \
//          [--limit         <n>] \
//          [--include-skipped <true|false>]
// Output: JSON with { placements, skipped }
//
// Environment:
//   MCP_URL (default: http://localhost:3000)
import { parseArgs } from "node:util";

type JsonRecord = Record<string, unknown>;

const MCP_URL = process.env["MCP_URL"] ?? "http://localhost:3000";

const { values } = parseArgs({
  options: {
    "keyword-flags": { type: "string" },
    "max-price": { type: "string" },
    "ad-position": { type: "string" },
    limit: { type: "string" },
    "include-skipped": { type: "string" },
  },
});

const includeSkipped = values["include-skipped"] === "true";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeHex(value: string): string {
  return value.toLowerCase().replace(/^0x/, "");
}

async function fetchSellerCard(gatewayUrl: string): Promise<JsonRecord> {
  const response = await fetch(`${gatewayUrl.replace(/\/+$/, "")}/.well-known/agent-card.json`);
  const body = await response.json() as unknown;
  if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`agent card fetch failed (${response.status})`);
  }
  return body as JsonRecord;
}

const params = new URLSearchParams({ status: "0", limit: values.limit ?? "50" });
if (values["keyword-flags"]) params.set("keyword_flags", values["keyword-flags"]);
if (values["max-price"]) params.set("max_price", values["max-price"]);
if (values["ad-position"]) params.set("ad_position", values["ad-position"]);

const response = await fetch(`${MCP_URL}/discover/placements?${params}`);
const body = await response.json() as unknown;
if (!response.ok || !Array.isArray(body)) {
  process.stderr.write(JSON.stringify({
    error: "placement discovery failed",
    detail: body,
  }) + "\n");
  process.exit(1);
}

const placements: JsonRecord[] = [];
const skipped: JsonRecord[] = [];

for (const candidate of body) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    if (includeSkipped) skipped.push({ reason: "invalid discovery entry", candidate });
    continue;
  }

  const entry = candidate as JsonRecord;
  const gatewayUrl = asNonEmptyString(entry["gateway_url"]);
  const sellerPubkey = asNonEmptyString(entry["seller_pubkey"]);

  if (!gatewayUrl) {
    if (includeSkipped) skipped.push({ reason: "missing gateway_url", candidate: entry });
    continue;
  }
  if (!sellerPubkey) {
    if (includeSkipped) skipped.push({ reason: "missing seller_pubkey", candidate: entry });
    continue;
  }

  try {
    const card = await fetchSellerCard(gatewayUrl);
    const cardUrl = asNonEmptyString(card["url"]);
    const cardPubkey = asNonEmptyString(card["pubkey"]);

    if (!cardUrl) {
      throw new Error("seller card missing url");
    }
    if (!cardPubkey) {
      throw new Error("seller card missing pubkey");
    }
    if (normalizeHex(cardPubkey) !== normalizeHex(sellerPubkey)) {
      throw new Error("seller pubkey mismatch");
    }

    placements.push({
      ...entry,
      seller_a2a_url: cardUrl,
      card_pubkey: cardPubkey,
      card_name: asNonEmptyString(card["name"]),
      card_description: asNonEmptyString(card["description"]),
    });
  } catch (err) {
    if (includeSkipped) {
      skipped.push({
        reason: err instanceof Error ? err.message : String(err),
        candidate: entry,
      });
    }
  }
}

console.log(JSON.stringify({ placements, skipped }));
