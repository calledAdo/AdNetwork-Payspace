#!/usr/bin/env node
// Sign cooperative-close fields using the workspace keyfile.
// The script constructs the canonical coop-close hash internally:
//   blake2b("ckb-default-hash", seller_udt(16 LE) || buyer_udt(16 LE) || channel_id(32))
//
// Usage:  node sign_coop.mjs \
//           --seller-udt <decimal_u128> \
//           --buyer-udt  <decimal_u128> \
//           --channel-id <0x...32bytes>
// Output: JSON with { signature, coop_signing_message, seller_udt, buyer_udt, channel_id }
//
// Environment:
//   AGENT_DIR  path to agent directory containing keyfile (required)
import { ccc } from "@ckb-ccc/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { skillsConfig } from "../../config.js";

const AGENT_DIR = skillsConfig.agentDir;
if (!AGENT_DIR) {
  process.stderr.write(JSON.stringify({ error: "AGENT_DIR environment variable is not set" }) + "\n");
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    "seller-udt": { type: "string" },
    "buyer-udt": { type: "string" },
    "channel-id": { type: "string" },
  },
});

if (!values["seller-udt"] || !values["buyer-udt"] || !values["channel-id"]) {
  process.stderr.write(JSON.stringify({
    error: "--seller-udt, --buyer-udt, and --channel-id are required",
  }) + "\n");
  process.exit(1);
}

const sellerUdt = BigInt(String(values["seller-udt"]));
const buyerUdt = BigInt(String(values["buyer-udt"]));
const channelIdBuf = Buffer.from(String(values["channel-id"]).replace(/^0x/, ""), "hex");
if (channelIdBuf.length !== 32) {
  process.stderr.write(JSON.stringify({ error: "channel-id must be 32 bytes" }) + "\n");
  process.exit(1);
}

const sellerBuf = Buffer.alloc(16);
sellerBuf.writeBigUInt64LE(sellerUdt & 0xffffffffffffffffn, 0);
sellerBuf.writeBigUInt64LE(sellerUdt >> 64n, 8);
const buyerBuf = Buffer.alloc(16);
buyerBuf.writeBigUInt64LE(buyerUdt & 0xffffffffffffffffn, 0);
buyerBuf.writeBigUInt64LE(buyerUdt >> 64n, 8);

const coopMsg = Buffer.from(
  new ccc.HasherCkb().update(sellerBuf).update(buyerBuf).update(channelIdBuf).digest().slice(2),
  "hex",
);

const { privkey } = JSON.parse(readFileSync(`${AGENT_DIR}/keyfile`, "utf8"));
const privkeyBytes = Buffer.from(privkey, "hex");
const raw = secp256k1.sign(coopMsg, privkeyBytes, { prehash: false, format: "recovered" });
const signature =
  "0x" +
  Buffer.concat([raw.slice(1, 33), raw.slice(33, 65), raw.slice(0, 1)]).toString("hex");

console.log(JSON.stringify({
  signature,
  coop_signing_message: "0x" + coopMsg.toString("hex"),
  seller_udt: String(values["seller-udt"]),
  buyer_udt: String(values["buyer-udt"]),
  channel_id: String(values["channel-id"]),
}));
