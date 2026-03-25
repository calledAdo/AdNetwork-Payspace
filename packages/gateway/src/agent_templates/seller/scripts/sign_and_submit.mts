#!/usr/bin/env -S npx tsx
// Build a transaction, sign it locally, and submit it.
// Wraps the repeated build → sign → submit pattern into one call.
//
// Usage:  npx tsx sign_and_submit.mts \
//           --build-url  <full POST URL for the build endpoint> \
//           --body       <JSON body for the build request> \
//           [--submit-url <full POST URL for submit>]
// Output: JSON from the submit endpoint (includes tx_hash)
//
// Default submit-url: $MCP_URL/transactions/submit
// For placement transactions use: $MCP_URL/placements/submit
//
// Environment:
//   AGENT_DIR  path to agent directory containing keyfile (required)
//   MCP_URL    base URL for MCP server (default: http://localhost:3000)
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
        "build-url": { type: "string" },
        "submit-url": { type: "string" },
        "body": { type: "string" },
    },
});
if (!values["build-url"] || !values["body"]) {
    process.stderr.write(JSON.stringify({ error: "--build-url and --body are required" }) + "\n");
    process.exit(1);
}
const buildUrl = values["build-url"];
const submitUrl = values["submit-url"] ?? `${MCP_URL}/transactions/submit`;
const body = values["body"];
// Step 1: Build
const buildRes = await fetch(buildUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
});
const built = await buildRes.json();
if (!buildRes.ok || !built.signing_message) {
    process.stderr.write(JSON.stringify({ error: "build endpoint did not return signing_message", detail: built }) + "\n");
    process.exit(1);
}
// Step 2: Sign
const { privkey } = JSON.parse(readFileSync(`${AGENT_DIR}/keyfile`, "utf8"));
const msgBytes = Buffer.from(built.signing_message.replace(/^0x/, ""), "hex");
const raw = secp256k1.sign(msgBytes, Buffer.from(privkey, "hex"), { format: "recovered" });
const signature = "0x" + Buffer.concat([raw.slice(1, 33), raw.slice(33, 65), raw.slice(0, 1)]).toString("hex");
// Step 3: Submit
const submitRes = await fetch(submitUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tx: built.tx, signature }),
});
const result = await submitRes.json();
if (!submitRes.ok) {
    process.stderr.write(JSON.stringify({ error: "submit failed", detail: result }) + "\n");
    process.exit(1);
}
console.log(JSON.stringify(result));
//# sourceMappingURL=sign_and_submit.mjs.map