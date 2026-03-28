#!/usr/bin/env node
// Recover the signer identity (pubkey + blake160) from a signed 32-byte message.
//
// Usage:
//   node signee.mjs --message <0x...32bytes> --signature <0x...65bytes>
//
// Signature encoding:
//   0x + r(32) || s(32) || recovery_id(1)
//
// Output:
//   { pubkey: "0x...33bytes", blake160: "0x...20bytes" }
import { ccc } from "@ckb-ccc/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    message: { type: "string" },
    signature: { type: "string" },
  },
});

if (!values.message || !values.signature) {
  process.stderr.write(JSON.stringify({ error: "--message and --signature are required" }) + "\n");
  process.exit(1);
}

const msgBytes = Buffer.from(String(values.message).replace(/^0x/, ""), "hex");
if (msgBytes.length !== 32) {
  process.stderr.write(JSON.stringify({ error: "message must be 32 bytes" }) + "\n");
  process.exit(1);
}

const sigBytes = Buffer.from(String(values.signature).replace(/^0x/, ""), "hex");
if (sigBytes.length !== 65) {
  process.stderr.write(JSON.stringify({ error: "signature must be 65 bytes (r||s||recovery_id)" }) + "\n");
  process.exit(1);
}

let pubkeyBytes;
try {
  // noble `recoverPublicKey` expects the 65-byte recovered signature as:
  //   recovery_id(1) || r(32) || s(32)
  // Our repo encodes signatures as:
  //   r(32) || s(32) || recovery_id(1)
  // So we rotate to match noble's expectation.
  const rotated = Buffer.concat([sigBytes.subarray(64, 65), sigBytes.subarray(0, 64)]);
  pubkeyBytes = secp256k1.recoverPublicKey(rotated, msgBytes, { prehash: false, compressed: true });
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: "failed to recover public key",
    detail: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}

const pubkeyHex = "0x" + Buffer.from(pubkeyBytes).toString("hex");
const hashHex = new ccc.HasherCkb().update(pubkeyBytes).digest();
const blake160 = "0x" + hashHex.slice(2, 42);

console.log(JSON.stringify({ pubkey: pubkeyHex, blake160 }));

