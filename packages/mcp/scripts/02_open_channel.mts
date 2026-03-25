#!/usr/bin/env tsx
// ─── Step 2: Open payment channel ────────────────────────────────────────────
//
// Buyer deposits UDT into a payment channel cell.
// The channel lock args encode both parties + channel_id.
//
// Run: npx tsx scripts/02_open_channel.mts
//
// Reads:  scripts/test_state.json  (buyer/seller lock args, udt_type_args)
// Writes: scripts/test_state.json  (channel_tx_hash, channel_index, channel_id, first_input_outpoint)

import { ccc } from "@ckb-ccc/core";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = resolve(__dir, "test_state.json");

// ── Keys ──────────────────────────────────────────────────────────────────────

const BUYER_PRIVATE_KEY =
  process.env["CKB_PRIVATE_KEY"] ??
  "d9d8ed1b72994ee895eb148e303771a77a60df9624cf00a4345dbc41bb6b6c80";

// ── Env vars for builder (set BEFORE dynamic import) ─────────────────────────

Object.assign(process.env, {
  CKB_RPC_URL: process.env["CKB_RPC_URL"] ?? "https://testnet.ckb.dev/rpc",
  CKB_INDEXER_URL:
    process.env["CKB_INDEXER_URL"] ?? "https://testnet.ckb.dev/indexer",
  // Deployed payment_channel_lock (from deployed_contracts.json)
  SETTLEMENT_LOCK_CODE_HASH:
    "0xbaa0260440e7fc70e040e5c3d2a0ce310a4377076d2aae98778d6519624daf8a",
  SETTLEMENT_LOCK_DEP_TX_HASH:
    "0x8b3b2060c795ae7bec86d84c20255314a258933641706e4ec0c634cd9704b04e",
  SETTLEMENT_LOCK_HASH_TYPE: "data1",
  // Deployed booking_space_type (needed by builder imports but not used in this step)
  BOOKING_SPACE_TYPE_CODE_HASH:
    "0x04d06a9d14324ccd64330d09789c6e58aff38ef845db49855ef365e0d768bc9d",
  BOOKING_SPACE_TYPE_DEP_TX_HASH:
    "0x8b3b2060c795ae7bec86d84c20255314a258933641706e4ec0c634cd9704b04e",
  BOOKING_SPACE_TYPE_HASH_TYPE: "data1",
});

// ── Dynamic imports (after env vars are set) ──────────────────────────────────

const { buildOpenChannel, bufferToHex, computeChannelId } =
  await import("../src/builder.js");

// ── Main ──────────────────────────────────────────────────────────────────────

console.log("\n=== Step 2: Open Payment Channel ===\n");

const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  buyer_lock_args: string;
  seller_lock_args: string;
  udt_type_args: string;
};

const { buyer_lock_args, seller_lock_args, udt_type_args } = state;

// Amount to lock into channel: 500 000 tokens
const UDT_AMOUNT = (5_000n * 10n ** 8n).toString();

console.log(`Buyer       : ${buyer_lock_args}`);
console.log(`Seller      : ${seller_lock_args}`);
console.log(`UDT type    : ${udt_type_args}`);
console.log(`UDT amount  : ${UDT_AMOUNT}\n`);

const result = await buildOpenChannel(buyer_lock_args, {
  seller_lock_args,
  udt_type_args,
  udt_amount: UDT_AMOUNT,
});

console.log(`tx_hash (unsigned): ${result.tx_hash}\n`);

// Use CCC native signer — avoids custom signing-message computation
const RPC_URL = process.env["CKB_RPC_URL"] ?? "https://testnet.ckb.dev/rpc";
const cccClient = new ccc.ClientPublicTestnet({ url: RPC_URL });
const privKeyHex = `0x${BUYER_PRIVATE_KEY.replace(/^0x/, "")}` as `0x${string}`;
const signer = new ccc.SignerCkbPrivateKey(cccClient, privKeyHex);

// Convert UnsignedTx → CCC Transaction, sign, and broadcast
const cccTx = ccc.Transaction.from({
  version: result.tx.version,
  cellDeps: result.tx.cell_deps.map((d) => ({
    outPoint: { txHash: d.out_point.tx_hash, index: BigInt(d.out_point.index) },
    depType: d.dep_type === "dep_group" ? "depGroup" : "code",
  })),
  headerDeps: result.tx.header_deps,
  inputs: result.tx.inputs.map((i) => ({
    previousOutput: {
      txHash: i.previous_output.tx_hash,
      index: BigInt(i.previous_output.index),
    },
    since: i.since,
  })),
  outputs: result.tx.outputs.map((o) => ({
    capacity: BigInt(o.capacity),
    lock: {
      codeHash: o.lock.code_hash,
      hashType: o.lock.hash_type,
      args: o.lock.args,
    },
    type: o.type
      ? {
          codeHash: o.type.code_hash,
          hashType: o.type.hash_type,
          args: o.type.args,
        }
      : null,
  })),
  outputsData: result.tx.outputs_data,
  witnesses: result.tx.witnesses,
});

console.log("Broadcasting...");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const confirmedHash = await signer.sendTransaction(cccTx as any);
console.log(`✓ channel tx_hash: ${confirmedHash}`);

// The channel cell is always at output index 0 in buildOpenChannel
const channelIndex = 0;

// Derive channel_id from the first input outpoint (same logic as builder)
const firstInput = result.tx.inputs[0]!.previous_output;
const channelIdBuf = computeChannelId(
  firstInput.tx_hash,
  parseInt(firstInput.index, 16),
);
const channelId = bufferToHex(channelIdBuf);

console.log(`channel_id: ${channelId}`);

// Save state
const updated = {
  ...state,
  channel_tx_hash: confirmedHash,
  channel_index: channelIndex,
  channel_id: channelId,
  udt_amount_in_channel: UDT_AMOUNT,
  first_input_outpoint: firstInput,
};
writeFileSync(STATE_FILE, JSON.stringify(updated, null, 2));
console.log(`\nState saved → ${STATE_FILE}`);
