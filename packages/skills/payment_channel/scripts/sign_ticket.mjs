#!/usr/bin/env node
// Sign an off-chain payment ticket using the buyer's local keyfile.
//
// Usage:  node sign_ticket.mjs \
//           --seller-claim <decimal_u128> \
//           --timestamp    <decimal_u64> \
//           --channel-id   <0x...32bytes>
// Output: JSON with { signature, seller_claim_udt, ticket_timestamp, channel_id }
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
    "seller-claim": { type: "string" },
    "timestamp": { type: "string" },
    "channel-id": { type: "string" },
  },
});
const sellerClaimStr = values["seller-claim"];
const timestampStr = values["timestamp"];
const channelIdStr = values["channel-id"];
if (!sellerClaimStr || !timestampStr || !channelIdStr) {
  process.stderr.write(JSON.stringify({ error: "--seller-claim, --timestamp, and --channel-id are required" }) + "\n");
  process.exit(1);
}
const sellerClaim = BigInt(sellerClaimStr);
const timestamp = BigInt(timestampStr);
const channelId = channelIdStr.replace(/^0x/, "");
const channelIdBuf = Buffer.from(channelId, "hex");
if (channelIdBuf.length !== 32) {
  process.stderr.write(JSON.stringify({ error: "channel-id must be 32 bytes" }) + "\n");
  process.exit(1);
}
const claimBuf = Buffer.alloc(16);
claimBuf.writeBigUInt64LE(sellerClaim & 0xffffffffffffffffn, 0);
claimBuf.writeBigUInt64LE(sellerClaim >> 64n, 8);
const tsBuf = Buffer.alloc(8);
tsBuf.writeBigUInt64LE(timestamp, 0);
const msg = Buffer.from(new ccc.HasherCkb().update(claimBuf).update(tsBuf).update(channelIdBuf).digest().slice(2), "hex");
const { privkey } = JSON.parse(readFileSync(`${AGENT_DIR}/keyfile`, "utf8"));
const raw = secp256k1.sign(msg, Buffer.from(privkey, "hex"), { format: "recovered" });
const signature = "0x" + Buffer.concat([raw.slice(1, 33), raw.slice(33, 65), raw.slice(0, 1)]).toString("hex");
console.log(JSON.stringify({
  signature,
  seller_claim_udt: sellerClaimStr,
  ticket_timestamp: timestampStr,
  channel_id: channelIdStr,
}));

