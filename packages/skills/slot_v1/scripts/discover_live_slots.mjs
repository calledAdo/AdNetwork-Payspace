#!/usr/bin/env -S npx tsx
// Canonical buyer discovery helper.
// It performs on-chain discovery, seller-card resolution, and seller-pubkey
// verification in one pass. Normal buyer flow should call this script first.
//
// Usage: node discover_live_slots.mjs \
//          [--keyword-flags <uint32>] \
//          [--max-price     <udt_per_mille>] \
//          [--ad-position   <0|1|2|3>] \
//          [--limit         <n>] \
//          [--include-skipped <true|false>]
// Output: JSON with { slots, skipped }
//
// On-chain BookingSpace type script: packages/ckb_payspace_mcp/src/constants.ts
import { parseArgs } from "node:util";
import { decodeBookingSpaceData } from "ckb_payspace_mcp/src/builder.ts";
import { getCellsByScript } from "ckb_payspace_mcp/src/ckb.ts";
import {
  PAYSPACE_BOOKING_SPACE_TYPE_CODE_HASH,
  PAYSPACE_BOOKING_SPACE_TYPE_HASH_TYPE,
} from "ckb_payspace_mcp/src/constants.ts";

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

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function asNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeHex(value) {
  return value.toLowerCase().replace(/^0x/, "");
}

async function fetchJson(url) {
  const response = await fetch(url);
  const body = await response.json();
  return { response, body };
}

async function fetchSellerCard(gatewayUrl) {
  const { response, body } = await fetchJson(
    `${gatewayUrl.replace(/\/+$/, "")}/.well-known/agent-card.json`,
  );
  const card = asObject(body);
  if (!response.ok || !card) {
    throw new Error(`agent card fetch failed (${response.status})`);
  }
  return card;
}

async function discoverSlots() {
  const typeScript = {
    code_hash: PAYSPACE_BOOKING_SPACE_TYPE_CODE_HASH,
    hash_type: PAYSPACE_BOOKING_SPACE_TYPE_HASH_TYPE,
    args: "0x",
  };
  const limit = values.limit ? Number(values.limit) : 50;
  const statusFilter = 0;
  const adPositionFilter = values["ad-position"]
    ? Number(values["ad-position"])
    : null;
  const maxPriceFilter = values["max-price"]
    ? BigInt(values["max-price"])
    : null;
  const keywordFlagsFilter = values["keyword-flags"]
    ? BigInt(values["keyword-flags"])
    : null;

  const result = await getCellsByScript(typeScript, "type", limit);
  const slots = [];

  for (const cell of result.objects) {
    if (!cell.output_data || cell.output_data === "0x") continue;
    try {
      const decoded = decodeBookingSpaceData(
        Buffer.from(cell.output_data.slice(2), "hex"),
      );
      if (decoded.status !== statusFilter) continue;
      if (adPositionFilter !== null && decoded.adPosition !== adPositionFilter)
        continue;
      if (maxPriceFilter !== null && decoded.pricePerMille > maxPriceFilter)
        continue;
      if (
        keywordFlagsFilter !== null &&
        decoded.keywordFlags !== keywordFlagsFilter
      )
        continue;

      const outPoint = cell.out_point;
      slots.push({
        placement_id: `${outPoint.tx_hash}:${outPoint.index}`,
        tx_hash: outPoint.tx_hash,
        index: outPoint.index,
        seller_pubkey: decoded.sellerPubkey,
        price_per_mille: decoded.pricePerMille.toString(),
        ad_position: decoded.adPosition,
        status: decoded.status,
        publication_mode: decoded.publicationMode,
        keyword_flags: decoded.keywordFlags.toString(),
        active_channel_id: decoded.activeChannelId,
        gateway_url: decoded.gatewayUrl,
        ipfs_present: decoded.ipfsPresent,
        details_cid: decoded.detailsCid,
        details_hash: decoded.detailsHash,
      });
    } catch {
      // skip invalid BookingSpace payloads
    }
  }

  return slots;
}

const discovered = await discoverSlots();
const slots = [];
const skipped = [];

for (const candidate of discovered) {
  const entry = asObject(candidate);
  if (!entry) {
    if (includeSkipped)
      skipped.push({ reason: "invalid discovery entry", candidate });
    continue;
  }

  const gatewayUrl = asNonEmptyString(entry.gateway_url);
  const sellerPubkey = asNonEmptyString(entry.seller_pubkey);

  if (!gatewayUrl) {
    if (includeSkipped)
      skipped.push({ reason: "missing gateway_url", candidate: entry });
    continue;
  }
  if (!sellerPubkey) {
    if (includeSkipped)
      skipped.push({ reason: "missing seller_pubkey", candidate: entry });
    continue;
  }

  try {
    const card = await fetchSellerCard(gatewayUrl);
    const cardUrl = asNonEmptyString(card.url);
    const cardPubkey = asNonEmptyString(card.pubkey);

    if (!cardUrl) throw new Error("seller card missing url");
    if (!cardPubkey) throw new Error("seller card missing pubkey");
    if (normalizeHex(cardPubkey) !== normalizeHex(sellerPubkey)) {
      throw new Error("seller pubkey mismatch");
    }

    slots.push({
      ...entry,
      seller_a2a_url: cardUrl,
      card_pubkey: cardPubkey,
      card_name: asNonEmptyString(card.name),
      card_description: asNonEmptyString(card.description),
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

console.log(JSON.stringify({ slots, skipped }));
