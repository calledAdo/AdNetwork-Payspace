#!/usr/bin/env -S npx tsx
// Register off-chain placement details with the Payspace API.
// Signs the details blob with the agent's local keyfile.
// Run after publishing a placement cell, or whenever details change.
//
// Placement ID (key) = tx_hash:index — the canonical outpoint of the cell.
//
// Usage:  npx tsx register_details.mts \
//           --seller        <lock_args> \
//           --tx-hash       <0x...> \
//           --index         <n> \
//           --site-url      <https://...> \
//           --dimensions    <WxH> \
//           --element-id    <dom-element-id> \
//           [--restrictions <cat1,cat2,...>] \
//           [--language     <en|fr|...>]
// Output: JSON from the Payspace API endpoint
//
// Environment:
//   AGENT_DIR        path to agent directory containing keyfile (required)
//   PAYSPACE_API_URL base URL for the Payspace API (required)
import { ccc } from "@ckb-ccc/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
const AGENT_DIR = process.env["AGENT_DIR"];
if (!AGENT_DIR) {
    process.stderr.write(JSON.stringify({ error: "AGENT_DIR environment variable is not set" }) + "\n");
    process.exit(1);
}
const PAYSPACE_API_URL = process.env["PAYSPACE_API_URL"] ?? "";
if (!PAYSPACE_API_URL) {
    process.stderr.write(JSON.stringify({ error: "PAYSPACE_API_URL environment variable is not set" }) + "\n");
    process.exit(1);
}
const { values } = parseArgs({
    options: {
        seller: { type: "string" },
        "tx-hash": { type: "string" },
        index: { type: "string" },
        "site-url": { type: "string" },
        dimensions: { type: "string" },
        "element-id": { type: "string" },
        restrictions: { type: "string" },
        language: { type: "string" },
    },
});
if (!values.seller || !values["tx-hash"] || !values.index ||
    !values["site-url"] || !values.dimensions || !values["element-id"]) {
    process.stderr.write(JSON.stringify({
        error: "--seller, --tx-hash, --index, --site-url, --dimensions, and --element-id are required",
    }) + "\n");
    process.exit(1);
}
const placementId = `${values["tx-hash"]}:${values.index}`;
const payload: Record<string, unknown> = {
    placement_id: placementId,
    site_url: values["site-url"],
    dimensions: values.dimensions,
    element_id: values["element-id"],
};
if (values.restrictions)
    payload["content_restrictions"] = values.restrictions.split(",");
if (values.language)
    payload["language"] = values.language;
// Hash and sign the payload
const payloadStr = JSON.stringify(payload);
const hashHex = new ccc.HasherCkb().update(Buffer.from(payloadStr)).digest();
const msgBytes = Buffer.from(hashHex.slice(2), "hex");
const { privkey } = JSON.parse(readFileSync(`${AGENT_DIR}/keyfile`, "utf8"));
const raw = secp256k1.sign(msgBytes, Buffer.from(privkey, "hex"), { format: "recovered" });
const signature = "0x" + Buffer.concat([raw.slice(1, 33), raw.slice(33, 65), raw.slice(0, 1)]).toString("hex");
const res = await fetch(`${PAYSPACE_API_URL}/placements/details`, {
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
//# sourceMappingURL=register_details.mjs.map
