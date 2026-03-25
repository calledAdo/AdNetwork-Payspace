#!/usr/bin/env tsx
// ─── Step 3: Buyer signs an off-chain payment ticket ─────────────────────────
//
// No chain transaction — this is pure crypto.
// The buyer signs a 56-byte ticket asserting how much UDT the seller has earned.
// The seller can later submit this ticket to dispute or coop-close the channel.
//
// Ticket format (56 bytes):
//   [0..16)   seller_claim_udt   u128 LE  — cumulative amount seller has earned
//   [16..24)  ticket_timestamp   u64  LE  — monotonic nonce (unix seconds)
//   [24..56)  channel_id         32 bytes — identifies the specific channel
//
// Signing message: blake2b("ckb-default-hash", ticket_bytes[0..56])
//
// Run: npx tsx scripts/03_sign_ticket.mts [seller_claim_amount]
//
// Reads:  scripts/test_state.json  (channel_id, udt_amount_in_channel)
// Writes: scripts/test_state.json  (latest_ticket: { seller_claim_udt, ticket_timestamp, buyer_sig })

import { secp256k1 }                  from "@noble/curves/secp256k1.js";
import blake2b                        from "blake2b";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname }           from "node:path";
import { fileURLToPath }              from "node:url";

const __dir    = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = resolve(__dir, "test_state.json");

// ── Keys ──────────────────────────────────────────────────────────────────────

const BUYER_PRIVATE_KEY = process.env["CKB_PRIVATE_KEY"]
  ?? "d9d8ed1b72994ee895eb148e303771a77a60df9624cf00a4345dbc41bb6b6c80";

// ── Helpers ───────────────────────────────────────────────────────────────────

function u64LE(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n, 0);
  return b;
}

function u128LE(n: bigint): Buffer {
  const b = Buffer.alloc(16);
  b.writeBigUInt64LE(n & 0xFFFFFFFFFFFFFFFFn, 0);
  b.writeBigUInt64LE(n >> 64n, 8);
  return b;
}

function ckbBlake2b(data: Buffer): Buffer {
  const personal = Buffer.alloc(16);
  personal.write("ckb-default-hash");
  const h = blake2b(32, undefined, undefined, personal);
  h.update(data);
  return Buffer.from(h.digest());
}

function sign(msgBuf: Buffer, privKeyHex: string): string {
  const privKey = Buffer.from(privKeyHex.replace(/^0x/, ""), "hex");
  // v2: prehash:false = skip SHA-256 (msgBuf is already blake2b hash); format:"recovered" = recovery||r||s
  // CKB wants r(32) || s(32) || recovery(1)
  const sig = secp256k1.sign(msgBuf, privKey, { lowS: true, prehash: false, format: "recovered" });
  const ckbSig = Buffer.concat([Buffer.from(sig.subarray(1)), Buffer.from([sig[0]!])]);
  return "0x" + ckbSig.toString("hex");
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log("\n=== Step 3: Sign Off-Chain Payment Ticket ===\n");

const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  channel_id:            string;
  udt_amount_in_channel: string;
  buyer_lock_args:       string;
  seller_lock_args:      string;
  latest_ticket?: {
    seller_claim_udt:   string;
    ticket_timestamp:   string;
  };
};

const channelId = Buffer.from(state.channel_id.replace(/^0x/, ""), "hex");
if (channelId.length !== 32) throw new Error("channel_id must be 32 bytes");

// Amount seller claims — from CLI arg or default to 10% of channel amount
const totalAmount = BigInt(state.udt_amount_in_channel);
const claimArg    = process.argv[2];
const sellerClaim = claimArg
  ? BigInt(claimArg)
  : totalAmount / 10n;  // default: seller claims 10%

// Timestamp must be strictly greater than any previous ticket
const prevTs = state.latest_ticket
  ? BigInt(state.latest_ticket.ticket_timestamp)
  : 0n;
const ticketTimestamp = BigInt(Math.floor(Date.now() / 1000));
if (ticketTimestamp <= prevTs) {
  throw new Error(`new timestamp ${ticketTimestamp} must be > previous ${prevTs}`);
}

console.log(`Channel ID      : 0x${channelId.toString("hex")}`);
console.log(`Channel total   : ${totalAmount}`);
console.log(`Seller claim    : ${sellerClaim}`);
console.log(`Buyer remainder : ${totalAmount - sellerClaim}`);
console.log(`Ticket timestamp: ${ticketTimestamp}\n`);

if (sellerClaim > totalAmount) {
  throw new Error(`seller claim ${sellerClaim} exceeds channel total ${totalAmount}`);
}

// Build 56-byte ticket
const ticket = Buffer.concat([
  u128LE(sellerClaim),    // [0..16)
  u64LE(ticketTimestamp), // [16..24)
  channelId,              // [24..56)
]);

// Sign: blake2b("ckb-default-hash", ticket)
const signingMsg = ckbBlake2b(ticket);
const buyerSig   = sign(signingMsg, BUYER_PRIVATE_KEY);

console.log(`Signing message : 0x${signingMsg.toString("hex")}`);
console.log(`Buyer signature : ${buyerSig}\n`);

// Save
const updated = {
  ...state,
  latest_ticket: {
    seller_claim_udt:  sellerClaim.toString(),
    ticket_timestamp:  ticketTimestamp.toString(),
    buyer_sig:         buyerSig,
  },
};
writeFileSync(STATE_FILE, JSON.stringify(updated, null, 2));
console.log(`✓ Ticket signed and saved → ${STATE_FILE}`);
console.log(`\nNext: run 04_coop_close.mts  OR  04b_dispute.mts`);
