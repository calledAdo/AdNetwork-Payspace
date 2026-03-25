#!/usr/bin/env tsx
// ─── Step 4: Cooperative channel close ───────────────────────────────────────
//
// Both buyer and seller agree on the final UDT split and sign it.
// The channel cell is consumed and two UDT output cells are created.
//
// Coop-close signing payload (different from the CKB tx signing message):
//   blake2b("ckb-default-hash", seller_udt(16 LE) || buyer_udt(16 LE) || channel_id(32))
//
// Both parties must sign this payload. The 130-byte combined witness
// (buyer_sig(65) || seller_sig(65)) is embedded into the channel cell's witness slot.
// The fee payer (buyer) also signs the CKB tx signing message for the CKB inputs.
//
// Run: npx tsx scripts/04_coop_close.mts [seller_udt] [buyer_udt]
//
// Reads:  scripts/test_state.json  (channel_tx_hash, channel_index, udt_amount_in_channel,
//                                   buyer/seller lock_args, latest_ticket)
// Writes: scripts/test_state.json  (close_tx_hash)

import { secp256k1 }                  from "@noble/curves/secp256k1.js";
import { ccc }                        from "@ckb-ccc/core";
import blake2b                        from "blake2b";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname }           from "node:path";
import { fileURLToPath }              from "node:url";

const __dir    = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = resolve(__dir, "test_state.json");

// ── Keys ──────────────────────────────────────────────────────────────────────

const BUYER_PRIVATE_KEY  = process.env["CKB_PRIVATE_KEY"]
  ?? "d9d8ed1b72994ee895eb148e303771a77a60df9624cf00a4345dbc41bb6b6c80";

const SELLER_PRIVATE_KEY =
  "0101010101010101010101010101010101010101010101010101010101010101";

// ── Env vars for builder ──────────────────────────────────────────────────────

Object.assign(process.env, {
  CKB_RPC_URL:                   process.env["CKB_RPC_URL"]   ?? "https://testnet.ckb.dev/rpc",
  CKB_INDEXER_URL:               process.env["CKB_INDEXER_URL"] ?? "https://testnet.ckb.dev/indexer",
  SETTLEMENT_LOCK_CODE_HASH:     "0xbaa0260440e7fc70e040e5c3d2a0ce310a4377076d2aae98778d6519624daf8a",
  SETTLEMENT_LOCK_DEP_TX_HASH:   "0x8b3b2060c795ae7bec86d84c20255314a258933641706e4ec0c634cd9704b04e",
  SETTLEMENT_LOCK_HASH_TYPE:     "data1",
  BOOKING_SPACE_TYPE_CODE_HASH:  "0x04d06a9d14324ccd64330d09789c6e58aff38ef845db49855ef365e0d768bc9d",
  BOOKING_SPACE_TYPE_DEP_TX_HASH:"0x8b3b2060c795ae7bec86d84c20255314a258933641706e4ec0c634cd9704b04e",
  BOOKING_SPACE_TYPE_HASH_TYPE:  "data1",
});

// ── Dynamic imports ───────────────────────────────────────────────────────────

const { buildCoopClose, injectSignature } = await import("../src/builder.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function sign(msgHexOrBuf: string | Buffer, privKeyHex: string): string {
  const msg     = Buffer.isBuffer(msgHexOrBuf)
    ? msgHexOrBuf
    : Buffer.from((msgHexOrBuf as string).replace(/^0x/, ""), "hex");
  const privKey = Buffer.from(privKeyHex.replace(/^0x/, ""), "hex");
  // v2: prehash:false = skip SHA-256 (msg is already blake2b hash); format:"recovered" = recovery||r||s
  // CKB wants r(32) || s(32) || recovery(1)
  const sig = secp256k1.sign(msg, privKey, { lowS: true, prehash: false, format: "recovered" });
  const ckbSig = Buffer.concat([Buffer.from(sig.subarray(1)), Buffer.from([sig[0]!])]);
  return "0x" + ckbSig.toString("hex");
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log("\n=== Step 4: Cooperative Close ===\n");

const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  channel_tx_hash:       string;
  channel_index:         number;
  channel_id:            string;
  udt_amount_in_channel: string;
  buyer_lock_args:       string;
  seller_lock_args:      string;
  latest_ticket?: { seller_claim_udt: string };
};

const { channel_tx_hash, channel_index, channel_id, udt_amount_in_channel } = state;

const totalUdt = BigInt(udt_amount_in_channel);

// Split: from CLI args or use latest ticket's seller claim (with remainder to buyer)
let sellerUdt: bigint;
let buyerUdt: bigint;

if (process.argv[2] && process.argv[3]) {
  sellerUdt = BigInt(process.argv[2]);
  buyerUdt  = BigInt(process.argv[3]);
} else if (state.latest_ticket) {
  sellerUdt = BigInt(state.latest_ticket.seller_claim_udt);
  buyerUdt  = totalUdt - sellerUdt;
} else {
  // Default: 50/50 split
  sellerUdt = totalUdt / 2n;
  buyerUdt  = totalUdt - sellerUdt;
}

if (sellerUdt + buyerUdt !== totalUdt) {
  throw new Error(`${sellerUdt} + ${buyerUdt} != channel total ${totalUdt}`);
}

console.log(`Channel cell    : ${channel_tx_hash}:${channel_index}`);
console.log(`Seller gets UDT : ${sellerUdt}`);
console.log(`Buyer  gets UDT : ${buyerUdt}\n`);

// ── Phase 1: compute coop_signing_message with dummy sigs ─────────────────────
// We need coop_signing_message to sign before we know the real sigs.
// coop_signing_message = blake2b(seller_udt(16LE) || buyer_udt(16LE) || channel_id(32))
// We can compute this locally — it's deterministic from the split + channel_id.

const channelIdBuf = Buffer.from(channel_id.replace(/^0x/, ""), "hex");
const coopPayload  = Buffer.concat([
  u128LE(sellerUdt),
  u128LE(buyerUdt),
  channelIdBuf,
]);
const coopSigningMsg = ckbBlake2b(coopPayload);
console.log(`Coop signing msg: 0x${coopSigningMsg.toString("hex")}\n`);

// ── Phase 2: both parties sign coop_signing_message ───────────────────────────

const buyerCoopSig  = sign(coopSigningMsg, BUYER_PRIVATE_KEY);
const sellerCoopSig = sign(coopSigningMsg, SELLER_PRIVATE_KEY);

console.log(`Buyer  coop sig : ${buyerCoopSig}`);
console.log(`Seller coop sig : ${sellerCoopSig}\n`);

// ── Phase 3: build the final tx with real coop sigs ───────────────────────────
// Caller is buyer (pays fee from CKB cells)

const result = await buildCoopClose(state.buyer_lock_args, {
  settlement_tx_hash: channel_tx_hash,
  settlement_index:   channel_index,
  seller_udt:         sellerUdt.toString(),
  buyer_udt:          buyerUdt.toString(),
  buyer_sig:          buyerCoopSig,
  seller_sig:         sellerCoopSig,
});

console.log(`tx_hash (unsigned): ${result.tx_hash}\n`);
console.log(`Signing message (fee): ${result.signing_message}\n`);

// ── Phase 4: sign the CKB fee inputs manually (preserves pre-built coop witness)
// Using the secp256k1 signer directly avoids CCC prepareTransaction which would
// add/reorder inputs and break the witness index alignment for the channel cell.

const feeSignature = sign(result.signing_message, BUYER_PRIVATE_KEY);
const signedTx = injectSignature(result.tx, feeSignature);

// ── Phase 5: broadcast the fully-signed transaction

const RPC_URL = process.env["CKB_RPC_URL"] ?? "https://testnet.ckb.dev/rpc";
const cccClient = new ccc.ClientPublicTestnet({ url: RPC_URL });

const cccTx = ccc.Transaction.from({
  version:     signedTx.version,
  cellDeps:    signedTx.cell_deps.map((d) => ({
    outPoint: { txHash: d.out_point.tx_hash, index: BigInt(d.out_point.index) },
    depType:  d.dep_type === "dep_group" ? "depGroup" : "code",
  })),
  headerDeps:  signedTx.header_deps,
  inputs:      signedTx.inputs.map((i) => ({
    previousOutput: { txHash: i.previous_output.tx_hash, index: BigInt(i.previous_output.index) },
    since: i.since,
  })),
  outputs:     signedTx.outputs.map((o) => ({
    capacity: BigInt(o.capacity),
    lock: { codeHash: o.lock.code_hash, hashType: o.lock.hash_type, args: o.lock.args },
    type: o.type ? { codeHash: o.type.code_hash, hashType: o.type.hash_type, args: o.type.args } : null,
  })),
  outputsData: signedTx.outputs_data,
  witnesses:   signedTx.witnesses,
});

console.log("Broadcasting...");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const closeTxHash = await cccClient.sendTransaction(cccTx as any);
console.log(`✓ close tx_hash: ${closeTxHash}`);

const updated = { ...state, close_tx_hash: closeTxHash };
writeFileSync(STATE_FILE, JSON.stringify(updated, null, 2));
console.log(`\nState saved → ${STATE_FILE}`);
console.log(`\nChannel closed! Check outputs:`);
console.log(`  Seller UDT cell: ${closeTxHash}:0  (${sellerUdt})`);
console.log(`  Buyer  UDT cell: ${closeTxHash}:1  (${buyerUdt})`);
