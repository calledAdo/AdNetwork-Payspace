#!/usr/bin/env tsx
// Consume the old deployment cells to reclaim their CKB.
// Both cells are locked to our secp256k1 wallet — spend them back to ourselves.
//
// Old deployment tx: 0x6289883e965f1617645c71a9e68a05efe2b4ac8ae95d1f9dbea66cf5972f2211
//   index 0 — booking_space_type code cell  (14,285 CKB)
//   index 1 — payment_channel_lock code cell (40,181 CKB)
//
// Run: npx tsx scripts/burn_old_deployment.mts

import { ccc }            from "@ckb-ccc/core";
import { fileURLToPath }  from "node:url";

const OLD_TX_HASH =
  "0x6289883e965f1617645c71a9e68a05efe2b4ac8ae95d1f9dbea66cf5972f2211";

const PRIVATE_KEY = process.env["CKB_PRIVATE_KEY"]
  ?? "d9d8ed1b72994ee895eb148e303771a77a60df9624cf00a4345dbc41bb6b6c80";

const RPC_URL = process.env["CKB_RPC_URL"] ?? "https://testnet.ckb.dev/rpc";

console.log("\n=== Burn Old Deployment Cells ===\n");
console.log(`RPC     : ${RPC_URL}`);
console.log(`Old tx  : ${OLD_TX_HASH}\n`);

const client  = new ccc.ClientPublicTestnet({ url: RPC_URL });
const privKey = `0x${PRIVATE_KEY.replace(/^0x/, "")}` as `0x${string}`;
const signer  = new ccc.SignerCkbPrivateKey(client, privKey);
const addr    = await signer.getRecommendedAddressObj();

console.log(`Wallet  : ${await signer.getRecommendedAddress()}`);

// Build tx spending both old code cells, returning all CKB to our wallet
const tx = ccc.Transaction.from({
  inputs: [
    { previousOutput: { txHash: OLD_TX_HASH, index: 0 } },
    { previousOutput: { txHash: OLD_TX_HASH, index: 1 } },
  ],
  outputs: [
    // Single output — all CKB back to us; capacity filled in after fee calc
    { capacity: 0n, lock: addr.script },
  ],
  outputsData: ["0x"],
});

await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.Secp256k1Blake160);

// Set output capacity = sum of inputs minus fee
await tx.completeFeeBy(signer, 1000n);

console.log("Signing and broadcasting...");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const txHash = await signer.sendTransaction(tx as any);
console.log(`✓ burn tx_hash: ${txHash}`);
console.log(`\n~54 466 CKB returned to wallet. Ready to redeploy.`);
