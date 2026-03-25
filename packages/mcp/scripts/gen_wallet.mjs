#!/usr/bin/env node
// Generate a new CKB testnet wallet.
// Outputs: private key, compressed public key, blake160 lock args, and testnet address.
//
// Usage:  node scripts/gen_wallet.mjs

import { secp256k1 } from "@noble/curves/secp256k1.js";
import blake2b from "blake2b";
import { randomBytes } from "node:crypto";

// ── bech32m ───────────────────────────────────────────────────────────────────

const BECH32M_CONST = 0x2bc830a3;
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

function hrpExpand(hrp) {
  const ret = [];
  for (const c of hrp) ret.push(c.charCodeAt(0) >> 5);
  ret.push(0);
  for (const c of hrp) ret.push(c.charCodeAt(0) & 31);
  return ret;
}

function createChecksum(hrp, data) {
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ BECH32M_CONST;
  return Array.from({ length: 6 }, (_, i) => (mod >> (5 * (5 - i))) & 31);
}

function convertbits(data, frombits, tobits, pad) {
  let acc = 0, bits = 0;
  const ret = [];
  const maxv = (1 << tobits) - 1;
  for (const value of data) {
    acc = (acc << frombits) | value;
    bits += frombits;
    while (bits >= tobits) {
      bits -= tobits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) ret.push((acc << (tobits - bits)) & maxv);
  return ret;
}

function bech32mEncode(hrp, data) {
  const enc = convertbits(data, 8, 5, true);
  const checksum = createChecksum(hrp, enc);
  return hrp + "1" + [...enc, ...checksum].map((d) => CHARSET[d]).join("");
}

// ── Key generation ────────────────────────────────────────────────────────────

const privKeyBytes = randomBytes(32);
const privKey = privKeyBytes.toString("hex");

const pubKeyBytes = secp256k1.getPublicKey(privKeyBytes, true); // compressed 33 bytes
const pubKey = "0x" + Buffer.from(pubKeyBytes).toString("hex");

// ── blake160 = first 20 bytes of blake2b-256(pubkey) ─────────────────────────

const hash = blake2b(32, null, null, Buffer.from("ckb-default-hash"));
hash.update(pubKeyBytes);
const digest = hash.digest();
const blake160 = "0x" + Buffer.from(digest).slice(0, 20).toString("hex");

// ── CKB testnet address (bech32m full format) ─────────────────────────────────
// Payload: [0x00] + code_hash(32) + hash_type(1) + args(20) = 54 bytes

const SECP256K1_CODE_HASH = "9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8";

const payload = Buffer.concat([
  Buffer.from([0x00]),                          // format type: full address
  Buffer.from(SECP256K1_CODE_HASH, "hex"),      // 32 bytes
  Buffer.from([0x01]),                          // hash_type: type
  Buffer.from(blake160.slice(2), "hex"),        // 20 bytes lock args
]);

const address = bech32mEncode("ckt", payload); // ckt = testnet

// ── Output ────────────────────────────────────────────────────────────────────

console.log("\n=== New CKB Testnet Wallet ===\n");
console.log(`Private key : ${privKey}`);
console.log(`Public key  : ${pubKey}`);
console.log(`Lock args   : ${blake160}`);
console.log(`Address     : ${address}`);
console.log("\n⚠️  Save your private key securely — it cannot be recovered.");
console.log("Get testnet CKB at: https://faucet.nervos.org/\n");
