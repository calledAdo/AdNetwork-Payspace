#!/usr/bin/env tsx
// ─── Step 1: Mint sUDT test tokens ───────────────────────────────────────────
//
// Creates sUDT (Simple UDT) cells for both the buyer and seller test wallets.
// The buyer's lock hash is used as the UDT type args (buyer = issuer).
//
// Run: npx tsx scripts/01_mint_sudt.mts
//
// Writes: scripts/test_state.json  { buyer_lock_args, seller_lock_args, udt_type_args }

import { ccc }          from "@ckb-ccc/core";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname }  from "node:path";
import { fileURLToPath }     from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = resolve(__dir, "test_state.json");

// ── Test wallets ──────────────────────────────────────────────────────────────
// Buyer  = key from .env.testnet
// Seller = second hardcoded test key (fund at https://faucet.nervos.org/)

const BUYER_PRIVATE_KEY  = process.env["CKB_PRIVATE_KEY"]
  ?? "d9d8ed1b72994ee895eb148e303771a77a60df9624cf00a4345dbc41bb6b6c80";

// A distinct test key for the seller side.
const SELLER_PRIVATE_KEY =
  "0101010101010101010101010101010101010101010101010101010101010101";

const RPC_URL = process.env["CKB_RPC_URL"] ?? "https://testnet.ckb.dev/rpc";

// Amount to mint per wallet (18 decimals — 1 000 000 tokens)
const MINT_AMOUNT = 1_000_000n * 10n ** 8n;

// xUDT (Extensible UDT) constants for Pudge testnet
const XUDT_CODE_HASH = "0x25c29dc317811a6f6f3985a7a9ebc4838bd388d19d0feeecf0bcd60f6c0975bb";
const UDT_CELL_CAPACITY = 142n * 100_000_000n;   // 142 CKB (enough for data + lock + type)

// ─── helpers ──────────────────────────────────────────────────────────────────

function u128LE(n: bigint): Uint8Array {
  const buf = new Uint8Array(16);
  new DataView(buf.buffer).setBigUint64(0, n & 0xFFFFFFFFFFFFFFFFn, true);
  new DataView(buf.buffer).setBigUint64(8, n >> 64n, true);
  return buf;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log("\n=== Step 1: Mint sUDT ===\n");
console.log(`RPC: ${RPC_URL}\n`);

const client = new ccc.ClientPublicTestnet({ url: RPC_URL });

const buyerPrivKey  = `0x${BUYER_PRIVATE_KEY.replace(/^0x/, "")}` as `0x${string}`;
const sellerPrivKey = `0x${SELLER_PRIVATE_KEY.replace(/^0x/, "")}` as `0x${string}`;

const buyerSigner  = new ccc.SignerCkbPrivateKey(client, buyerPrivKey);
const sellerSigner = new ccc.SignerCkbPrivateKey(client, sellerPrivKey);

const buyerAddr    = await buyerSigner.getRecommendedAddressObj();
const sellerAddr   = await sellerSigner.getRecommendedAddressObj();

console.log(`Buyer  lock args: ${buyerAddr.script.args}`);
console.log(`Seller lock args: ${sellerAddr.script.args}`);

// xUDT type args = blake2b hash of buyer's lock script (buyer = issuer)
const udtTypeArgs = ccc.hashCkb(buyerAddr.script.toBytes());
console.log(`UDT type args  : ${udtTypeArgs}\n`);

// Build type script
const udtType = ccc.Script.from({
  codeHash: XUDT_CODE_HASH,
  hashType: "type",
  args:     udtTypeArgs,
});

// Build tx: two xUDT outputs (buyer + seller), using buyer as issuer/signer
const tx = ccc.Transaction.from({
  outputs: [
    // buyer gets MINT_AMOUNT
    { capacity: UDT_CELL_CAPACITY, lock: buyerAddr.script,  type: udtType },
    // seller gets MINT_AMOUNT
    { capacity: UDT_CELL_CAPACITY, lock: sellerAddr.script, type: udtType },
  ],
  outputsData: [
    ccc.hexFrom(u128LE(MINT_AMOUNT)),
    ccc.hexFrom(u128LE(MINT_AMOUNT)),
  ],
});

// Add cell deps: secp256k1 + xUDT
await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.Secp256k1Blake160);
await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.XUdt);

// Collect inputs from buyer (issuer must be in inputs for minting sUDT)
await tx.completeInputsByCapacity(buyerSigner);
await tx.completeFeeBy(buyerSigner, 1000n);

console.log("Signing and broadcasting...");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const txHash = await buyerSigner.sendTransaction(tx as any);
console.log(`✓ tx_hash: ${txHash}`);

// Save state
const existing = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, "utf8")) as Record<string, unknown>
  : {};

const state = {
  ...existing,
  buyer_lock_args:  buyerAddr.script.args,
  seller_lock_args: sellerAddr.script.args,
  udt_type_args:    udtTypeArgs,
  mint_tx_hash:     txHash,
};
writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
console.log(`\nState saved → ${STATE_FILE}`);
console.log(`\nBuyer  : ${await buyerSigner.getRecommendedAddress()}`);
console.log(`Seller : ${await sellerSigner.getRecommendedAddress()}`);
console.log(`\n⚠  Fund seller if needed: https://faucet.nervos.org/`);
