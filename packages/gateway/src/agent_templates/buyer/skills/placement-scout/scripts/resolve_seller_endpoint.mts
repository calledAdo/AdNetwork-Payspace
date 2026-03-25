#!/usr/bin/env -S npx tsx
// Resolve and verify the seller endpoint for one discovered placement.
// Fetches the seller's agent card from the gateway_url and verifies that the
// advertised pubkey matches the placement's on-chain seller_pubkey.
//
// Usage: npx tsx resolve_seller_endpoint.mts \
//          --gateway-url   <https://.../a2a/agent_...> \
//          --seller-pubkey <0x...>
// Output: JSON with gateway_url, seller_a2a_url, seller_pubkey, and card
import { parseArgs } from "node:util";

type AgentCard = {
  url?: unknown;
  pubkey?: unknown;
  name?: unknown;
  description?: unknown;
};

const { values } = parseArgs({
  options: {
    "gateway-url": { type: "string" },
    "seller-pubkey": { type: "string" },
  },
});

if (!values["gateway-url"] || !values["seller-pubkey"]) {
  process.stderr.write(JSON.stringify({
    error: "--gateway-url and --seller-pubkey are required",
  }) + "\n");
  process.exit(1);
}

function normalizeHex(value: string): string {
  return value.toLowerCase().replace(/^0x/, "");
}

const gatewayUrl = values["gateway-url"].replace(/\/+$/, "");
const sellerPubkey = values["seller-pubkey"];

let card: AgentCard;
try {
  const response = await fetch(`${gatewayUrl}/.well-known/agent-card.json`);
  card = await response.json() as AgentCard;
  if (!response.ok) {
    process.stderr.write(JSON.stringify({
      error: "failed to fetch seller card",
      gateway_url: gatewayUrl,
      detail: card,
    }) + "\n");
    process.exit(1);
  }
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: "seller card fetch failed",
    gateway_url: gatewayUrl,
    detail: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}

if (typeof card.pubkey !== "string" || !card.pubkey.trim()) {
  process.stderr.write(JSON.stringify({
    error: "seller card missing pubkey",
    gateway_url: gatewayUrl,
    card,
  }) + "\n");
  process.exit(1);
}

if (typeof card.url !== "string" || !card.url.trim()) {
  process.stderr.write(JSON.stringify({
    error: "seller card missing url",
    gateway_url: gatewayUrl,
    card,
  }) + "\n");
  process.exit(1);
}

const cardPubkey = card.pubkey;
if (normalizeHex(cardPubkey) !== normalizeHex(sellerPubkey)) {
  process.stderr.write(JSON.stringify({
    error: "seller pubkey mismatch",
    gateway_url: gatewayUrl,
    seller_pubkey: sellerPubkey,
    card_pubkey: cardPubkey,
  }) + "\n");
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  gateway_url: gatewayUrl,
  seller_a2a_url: card.url,
  seller_pubkey: sellerPubkey,
  card_pubkey: cardPubkey,
  card,
}));
