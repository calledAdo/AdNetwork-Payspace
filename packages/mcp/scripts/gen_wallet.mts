#!/usr/bin/env -S npx tsx
// Generate a new CKB testnet wallet.
// Outputs: private key, compressed public key, blake160 lock args, and testnet address.
//
// Usage:  npx tsx scripts/gen_wallet.mts

import { ccc } from "@ckb-ccc/core";
import { secp256k1 } from "@noble/curves/secp256k1";
import { randomBytes } from "node:crypto";

const privkeyBytes = randomBytes(32);
const privkeyHex = privkeyBytes.toString("hex");

const pubkeyBytes = secp256k1.getPublicKey(privkeyBytes, true); // compressed 33 bytes
const pubkeyHex = Buffer.from(pubkeyBytes).toString("hex");

// blake160 = first 20 bytes of CKB-blake2b(pubkey)
const hashHex = new ccc.HasherCkb().update(pubkeyBytes).digest(); // "0x..."
const blake160 = "0x" + hashHex.slice(2, 42);

// Derive testnet address via CCC
const client = new ccc.ClientPublicTestnet();
const signer = new ccc.SignerCkbPrivateKey(client, ("0x" + privkeyHex) as `0x${string}`);
const address = await signer.getRecommendedAddress();

console.log("\n=== New CKB Testnet Wallet ===\n");
console.log(`Private key : ${privkeyHex}`);
console.log(`Public key  : 0x${pubkeyHex}`);
console.log(`Lock args   : ${blake160}`);
console.log(`Address     : ${address}`);
console.log("\nSave your private key securely — it cannot be recovered.");
console.log("Get testnet CKB at: https://faucet.nervos.org/\n");
