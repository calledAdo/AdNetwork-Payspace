#!/usr/bin/env node
// Recover ticket signer identity from an off-chain payment ticket.
//
// This script is intentionally **recovery-only**:
// - it constructs the canonical ticket signing message
// - it recovers `{ pubkey, blake160 }` via native_signer `signee.mjs`
// - it does NOT enforce monotonicity or channel binding rules
//
// Usage: node receive_signed_ticket.mjs \
//          --seller-claim <decimal_u128> \
//          --timestamp    <decimal_u64> \
//          --channel-id   <0x...32bytes> \
//          --signature    <0x...65bytes>
//
// Output: JSON { signer: { pubkey, blake160 }, ticket: {...}, message }
import { ccc } from "@ckb-ccc/core";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { values } = parseArgs({
  options: {
    "seller-claim": { type: "string" },
    "timestamp": { type: "string" },
    "channel-id": { type: "string" },
    "signature": { type: "string" },
  },
});

const sellerClaimStr = values["seller-claim"];
const timestampStr = values["timestamp"];
const channelIdStr = values["channel-id"];
const signatureStr = values["signature"];

if (!sellerClaimStr || !timestampStr || !channelIdStr || !signatureStr) {
  process.stderr.write(JSON.stringify({
    error: "--seller-claim, --timestamp, --channel-id, and --signature are required",
  }) + "\n");
  process.exit(1);
}

const sellerClaim = BigInt(sellerClaimStr);
const timestamp = BigInt(timestampStr);
const channelIdHex = String(channelIdStr).replace(/^0x/, "");
const channelIdBuf = Buffer.from(channelIdHex, "hex");
if (channelIdBuf.length !== 32) {
  process.stderr.write(JSON.stringify({ error: "channel-id must be 32 bytes" }) + "\n");
  process.exit(1);
}

// Build canonical ticket signing message: blake2b( seller_claim(u128 LE) || timestamp(u64 LE) || channel_id(32) )
const claimBuf = Buffer.alloc(16);
claimBuf.writeBigUInt64LE(sellerClaim & 0xffffffffffffffffn, 0);
claimBuf.writeBigUInt64LE(sellerClaim >> 64n, 8);
const tsBuf = Buffer.alloc(8);
tsBuf.writeBigUInt64LE(timestamp, 0);

const msgBytes = Buffer.from(
  new ccc.HasherCkb().update(claimBuf).update(tsBuf).update(channelIdBuf).digest().slice(2),
  "hex",
);
const message = "0x" + msgBytes.toString("hex");

// Call native_signer signee.mjs (sibling skill directory under $SKILLS_DIR in deployed workspaces).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const signeePath = path.resolve(__dirname, "../../native_signer/scripts/signee.mjs");

const child = spawnSync(
  "node",
  [
    signeePath,
    "--message", message,
    "--signature", String(signatureStr),
  ],
  { encoding: "utf8" },
);

if (child.status !== 0) {
  process.stderr.write(JSON.stringify({
    error: "signee_failed",
    status: child.status,
    stderr: child.stderr,
    stdout: child.stdout,
  }) + "\n");
  process.exit(child.status ?? 1);
}

let signer;
try {
  signer = JSON.parse(child.stdout);
} catch {
  process.stderr.write(JSON.stringify({
    error: "signee_invalid_json",
    stdout: child.stdout,
  }) + "\n");
  process.exit(1);
}

console.log(JSON.stringify({
  signer,
  ticket: {
    seller_claim_udt: String(sellerClaimStr),
    ticket_timestamp: String(timestampStr),
    channel_id: String(channelIdStr),
    signature: String(signatureStr),
  },
  message,
}));

