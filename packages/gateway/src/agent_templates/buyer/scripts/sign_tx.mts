#!/usr/bin/env -S npx tsx
// Sign a CKB transaction signing_message using the agent's local keyfile.
// No HTTP call — reads $AGENT_DIR/keyfile directly.
//
// Usage:  npx tsx sign_tx.mts --message <0x...32bytes>
// Output: JSON with { signature }
//   signature: 65-byte hex — r(32) || s(32) || recovery_id(1)
//
// Environment:
//   AGENT_DIR  path to agent directory containing keyfile (required)
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
const AGENT_DIR = process.env["AGENT_DIR"];
if (!AGENT_DIR) {
    process.stderr.write(JSON.stringify({ error: "AGENT_DIR environment variable is not set" }) + "\n");
    process.exit(1);
}
const { values } = parseArgs({ options: { message: { type: "string" } } });
if (!values.message) {
    process.stderr.write(JSON.stringify({ error: "--message is required" }) + "\n");
    process.exit(1);
}
const { privkey } = JSON.parse(readFileSync(`${AGENT_DIR}/keyfile`, "utf8"));
const privkeyBytes = Buffer.from(privkey, "hex");
const msgBytes = Buffer.from(values.message.replace(/^0x/, ""), "hex");
// @noble/curves v2: sign with { format: "recovered" } → [v(1), r(32), s(32)]
// CKB expects r(32) || s(32) || v(1)
const raw = secp256k1.sign(msgBytes, privkeyBytes, { prehash: false, format: "recovered" });
const signature = "0x" + Buffer.concat([raw.slice(1, 33), raw.slice(33, 65), raw.slice(0, 1)]).toString("hex");
console.log(JSON.stringify({ signature }));
//# sourceMappingURL=sign_tx.mjs.map