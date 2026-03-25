#!/usr/bin/env -S npx tsx
// Build a cancel-booking transaction to reclaim a placement cell.
// Reverts the placement cell status back to available (0).
//
// Usage:  npx tsx unbook_placement.mts \
//           --seller     <lock_args> \
//           --tx-hash    <0x...> \
//           --index      <n> \
//           [--fee-payer <lock_args>]   # inject fee-tank cell at exact on-chain rate
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
        "fee-payer": { type: "string" },
    },
});
if (!values.seller || !values["tx-hash"] || !values.index) {
    process.stderr.write(JSON.stringify({ error: "--seller, --tx-hash, and --index are required" }) + "\n");
    process.exit(1);
}
const body: Record<string, unknown> = {
    seller_lock_args: values.seller,
    placement_tx_hash: values["tx-hash"],
    placement_index: Number(values.index),
};
if (values["fee-payer"])
    body["fee_payer_lock_args"] = values["fee-payer"];
const res = await fetch(`${MCP_URL}/placements/build/cancel`, {
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
//# sourceMappingURL=unbook_placement.mjs.map
