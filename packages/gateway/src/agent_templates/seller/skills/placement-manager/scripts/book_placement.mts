#!/usr/bin/env -S npx tsx
// Build a transaction that confirms a booking on an existing placement cell.
// Flips the cell status from available (0) to taken (1).
//
// Usage:  npx tsx book_placement.mts \
//           --seller      <lock_args> \
//           --tx-hash     <0x...> \
//           --index       <n> \
//           --channel-tx  <0x...> \
//           [--fee-payer  <lock_args>]   # inject fee-tank cell at exact on-chain rate
// Output: JSON with { tx, tx_hash, signing_message }
//
// Environment:
//   MCP_URL (default: http://localhost:3000)
import { parseArgs } from "node:util";
const MCP_URL = process.env["MCP_URL"] ?? "http://localhost:3000";
const { values } = parseArgs({
    options: {
        seller: { type: "string" },
        "tx-hash": { type: "string" },
        index: { type: "string" },
        "channel-tx": { type: "string" },
        "fee-payer": { type: "string" },
    },
});
if (!values.seller || !values["tx-hash"] || !values.index || !values["channel-tx"]) {
    process.stderr.write(JSON.stringify({ error: "--seller, --tx-hash, --index, and --channel-tx are required" }) + "\n");
    process.exit(1);
}
const body: Record<string, unknown> = {
    seller_lock_args: values.seller,
    placement_tx_hash: values["tx-hash"],
    placement_index: Number(values.index),
    channel_tx_hash: values["channel-tx"],
};
if (values["fee-payer"])
    body["fee_payer_lock_args"] = values["fee-payer"];
const res = await fetch(`${MCP_URL}/placements/build/book`, {
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
//# sourceMappingURL=book_placement.mjs.map
