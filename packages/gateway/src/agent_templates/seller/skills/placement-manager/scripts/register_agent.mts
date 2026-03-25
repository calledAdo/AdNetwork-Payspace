#!/usr/bin/env -S npx tsx
// Register this agent's A2A card in the PaySpace MCP discovery registry.
// Signs the registration payload with the agent's local keyfile.
// Run once at agent startup and whenever the gateway URL changes.
//
// Usage:  npx tsx register_agent.mts \
//           --blake160  <0x...20bytes> \
//           --pubkey    <0x...33bytes> \
//           --a2a-url   <https://...>
// Output: JSON from the MCP registry endpoint
//
// Environment:
//   AGENT_DIR  path to agent directory containing keyfile (required)
//   MCP_URL    (default: http://localhost:3000)
import { ccc } from "@ckb-ccc/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
const AGENT_DIR = process.env["AGENT_DIR"];
if (!AGENT_DIR) {
    process.stderr.write(JSON.stringify({ error: "AGENT_DIR environment variable is not set" }) + "\n");
    process.exit(1);
}
const MCP_URL = process.env["MCP_URL"] ?? "http://localhost:3000";
const { values } = parseArgs({
    options: {
        blake160: { type: "string" },
        pubkey: { type: "string" },
        "a2a-url": { type: "string" },
    },
});
if (!values.blake160 || !values.pubkey || !values["a2a-url"]) {
    process.stderr.write(JSON.stringify({ error: "--blake160, --pubkey, and --a2a-url are required" }) + "\n");
    process.exit(1);
}
const payload = {
    blake160: values.blake160,
    pubkey: values.pubkey,
    a2a_url: values["a2a-url"],
    registered_at: Math.floor(Date.now() / 1000),
};
// Hash and sign the canonical JSON payload
const payloadStr = JSON.stringify(payload);
const hashHex = new ccc.HasherCkb().update(Buffer.from(payloadStr)).digest();
const msgBytes = Buffer.from(hashHex.slice(2), "hex");
const { privkey } = JSON.parse(readFileSync(`${AGENT_DIR}/keyfile`, "utf8"));
const raw = secp256k1.sign(msgBytes, Buffer.from(privkey, "hex"), { format: "recovered" });
const signature = "0x" + Buffer.concat([raw.slice(1, 33), raw.slice(33, 65), raw.slice(0, 1)]).toString("hex");
const res = await fetch(`${MCP_URL}/discover/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, signature }),
});
const data = await res.json();
if (!res.ok) {
    process.stderr.write(JSON.stringify(data) + "\n");
    process.exit(1);
}
console.log(JSON.stringify(data));
//# sourceMappingURL=register_agent.mjs.map