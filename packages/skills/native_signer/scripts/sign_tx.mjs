#!/usr/bin/env node
// Sign a CKB transaction signing_message using PRIVATE_KEY from environment.
// No HTTP call.
//
// Usage:  node sign_tx.mjs --message <0x...32bytes>
// Output: JSON with { signature }
//   signature: 65-byte hex — r(32) || s(32) || recovery_id(1)
//
// Environment:
//   PRIVATE_KEY  hex secp256k1 private key (required)
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { parseArgs } from "node:util";
import { skillsConfig } from "../../config.js";

const { values } = parseArgs({ options: { message: { type: "string" } } });
if (!values.message) {
  process.stderr.write(JSON.stringify({ error: "--message is required" }) + "\n");
  process.exit(1);
}

const privkey = skillsConfig.privateKey;
if (!privkey) {
  process.stderr.write(JSON.stringify({ error: "PRIVATE_KEY not set" }) + "\n");
  process.exit(1);
}

const privkeyBytes = Buffer.from(privkey, "hex");
const msgBytes = Buffer.from(String(values.message).replace(/^0x/, ""), "hex");
const raw = secp256k1.sign(msgBytes, privkeyBytes, {
  prehash: false,
  format: "recovered",
});
const signature =
  "0x" +
  Buffer.concat([
    raw.slice(1, 33),
    raw.slice(33, 65),
    raw.slice(0, 1),
  ]).toString("hex");
console.log(JSON.stringify({ signature }));

