#!/usr/bin/env tsx
// Deploy BookingSpace type script and PaymentChannel lock script to CKB testnet.
// Each contract binary is stored as cell data in a dedicated "code cell".
//
// Usage:  npx tsx scripts/deploy_contracts.mts

import { ccc } from "@ckb-ccc/core";
import blake2b from "blake2b";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const PRIVATE_KEY =
  process.env["CKB_PRIVATE_KEY"] ??
  "d9d8ed1b72994ee895eb148e303771a77a60df9624cf00a4345dbc41bb6b6c80";

const RPC_URL = process.env["CKB_RPC_URL"] ?? "https://testnet.ckb.dev/";

const CONTRACTS_DIR = resolve(
  __dir,
  "../../../contracts/target/riscv64imac-unknown-none-elf/release",
);

interface ContractSpec {
  name: string;
  file: string;
}
const CONTRACTS: ContractSpec[] = [
  {
    name: "booking_space_type",
    file: resolve(CONTRACTS_DIR, "booking-space-type"),
  },
  {
    name: "payment_channel_lock",
    file: resolve(CONTRACTS_DIR, "payment-channel-lock"),
  },
];

interface DeployedContract {
  tx_hash: string;
  index: number;
  code_hash: string;
  hash_type: "data1";
  size_bytes: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ckbDataHash(buf: Uint8Array): string {
  const personal = Buffer.alloc(16);
  personal.write("ckb-default-hash");
  const h = blake2b(32, undefined, undefined, personal);
  h.update(buf);
  return "0x" + Buffer.from(h.digest()).toString("hex");
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log("\n=== CKB Contract Deployment ===\n");
console.log(`RPC    : ${RPC_URL}\n`);

// 1. Set up CCC client + signer
const client = new ccc.ClientPublicTestnet({ url: RPC_URL });
const privKeyHex = `0x${PRIVATE_KEY.replace(/^0x/, "")}` as `0x${string}`;
const signer = new ccc.SignerCkbPrivateKey(client, privKeyHex);

const addrObj = await signer.getRecommendedAddressObj();
console.log(`Wallet : ${(await signer.getRecommendedAddress()).toString()}`);

// 2. Read contract binaries
const contractData = CONTRACTS.map((c) => {
  const bytes = readFileSync(c.file);
  console.log(
    `${c.name}: ${bytes.length.toLocaleString()} bytes (${(bytes.length / 1024).toFixed(1)} KB)`,
  );
  return { ...c, bytes };
});

// 3. Build transaction
//    cell_size = capacity(8) + lock(secp256k1=53) + data(N) bytes → * 1 CKB/byte
const tx = ccc.Transaction.from({
  outputs: contractData.map((c) => ({
    capacity: (8n + 53n + BigInt(c.bytes.length)) * 100_000_000n,
    lock: addrObj.script,
  })),
  outputsData: contractData.map((c) => ccc.hexFrom(c.bytes)),
});

// 4. Add secp256k1 cell dep
await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.Secp256k1Blake160);

// 5. Collect inputs, add change, compute fee
await tx.completeInputsByCapacity(signer);
await tx.completeFeeBy(signer, 1000n);

// 6. Sign and broadcast
console.log("\nSigning and broadcasting...");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const txHash = await signer.sendTransaction(tx as any);
console.log(`✓ Submitted! tx_hash: ${txHash}`);

// 7. Save deployment record
const deployed: Record<string, DeployedContract> = {};
for (let i = 0; i < contractData.length; i++) {
  const c = contractData[i]!;
  const codeHash = ckbDataHash(c.bytes);
  deployed[c.name] = {
    tx_hash: txHash,
    index: i,
    code_hash: codeHash,
    hash_type: "data1",
    size_bytes: c.bytes.length,
  };
  console.log(`\n${c.name}:`);
  console.log(`  out_point : ${txHash}:${i}`);
  console.log(`  code_hash : ${codeHash}  (data1)`);
}

const outPath = resolve(__dir, "deployed_contracts.json");
writeFileSync(outPath, JSON.stringify(deployed, null, 2));
console.log(`\nDeployment record saved to: ${outPath}\n`);
