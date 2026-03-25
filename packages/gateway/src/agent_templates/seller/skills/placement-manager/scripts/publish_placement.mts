#!/usr/bin/env -S npx tsx
// Build a transaction that publishes a new BookingSpace placement cell on-chain.
// The agent signs the returned tx and calls submit separately.
//
// Usage:  npx tsx publish_placement.mts \
//           --seller         <lock_args> \
//           --pubkey         <0x...33bytes> \
//           --price          <udt_per_mille> \
//           --ad-position    <0|1|2|3> \
//           --pub-mode       <SNIPPET_MANAGED|MANUAL> \
//           --keyword-flags  <uint32> \
//           [--gateway-url   <https://...>] \
//           [--ipfs-present  <true|false>] \
//           [--details-cid   <CIDv1>] \
//           [--details-hash  <0x...32bytes>] \
//           [--fee-payer     <lock_args>]    # inject fee-tank cell at exact on-chain rate
// Output: JSON with { tx, tx_hash, signing_message }
//
// Environment:
//   MCP_URL (default: http://localhost:3000)
import { parseArgs } from "node:util";
const MCP_URL = process.env["MCP_URL"] ?? "http://localhost:3000";
const { values } = parseArgs({
    options: {
        seller: { type: "string" },
        pubkey: { type: "string" },
        price: { type: "string" },
        "ad-position": { type: "string" },
        "pub-mode": { type: "string" },
        "keyword-flags": { type: "string" },
        "gateway-url": { type: "string" },
        "ipfs-present": { type: "string" },
        "details-cid": { type: "string" },
        "details-hash": { type: "string" },
        "fee-payer": { type: "string" },
    },
});
if (!values.seller || !values.pubkey || !values.price ||
    !values["ad-position"] || !values["pub-mode"] || !values["keyword-flags"]) {
    process.stderr.write(JSON.stringify({
        error: "--seller, --pubkey, --price, --ad-position, --pub-mode, and --keyword-flags are all required",
    }) + "\n");
    process.exit(1);
}
const body: Record<string, unknown> = {
    seller_lock_args: values.seller,
    seller_pubkey: values.pubkey,
    price_per_mille: values.price,
    ad_position: Number(values["ad-position"]),
    publication_mode: values["pub-mode"],
    keyword_flags: Number(values["keyword-flags"]),
};
if (values["gateway-url"])
    body["gateway_url"] = values["gateway-url"];
if (values["ipfs-present"])
    body["ipfs_present"] = values["ipfs-present"] === "true";
if (values["details-cid"])
    body["details_cid"] = values["details-cid"];
if (values["details-hash"])
    body["details_hash"] = values["details-hash"];
if (values["fee-payer"])
    body["fee_payer_lock_args"] = values["fee-payer"];
const res = await fetch(`${MCP_URL}/placements/build/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
});
const data = await res.json();
if (!res.ok) {
    process.stderr.write(JSON.stringify(data) + "\n");
    process.exit(1);
}
console.log(JSON.stringify(data));
//# sourceMappingURL=publish_placement.mjs.map
