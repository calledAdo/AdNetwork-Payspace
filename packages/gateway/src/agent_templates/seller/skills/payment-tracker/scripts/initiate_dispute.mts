#!/usr/bin/env -S npx tsx
// Initiate (or update) an on-chain dispute using the last valid payment ticket.
// Call this when the buyer stops sending off-chain payment tickets.
//
// Usage:  npx tsx initiate_dispute.mts \
//           --caller            <lock_args> \
//           --settlement-tx     <0x...> \
//           --settlement-index  <n> \
//           --seller-claim      <udt_units> \
//           --ticket-timestamp  <decimal_nonce> \
//           --buyer-sig         <0x...65bytes> \
//           [--fee-payer        <lock_args>]   # inject fee-tank cell at exact on-chain rate
// Output: JSON with { tx, tx_hash, signing_message }
//
// Environment:
//   MCP_URL (default: http://localhost:3000)
import { parseArgs } from "node:util";
const MCP_URL = process.env["MCP_URL"] ?? "http://localhost:3000";
const { values } = parseArgs({
    options: {
        caller: { type: "string" },
        "settlement-tx": { type: "string" },
        "settlement-index": { type: "string" },
        "seller-claim": { type: "string" },
        "ticket-timestamp": { type: "string" },
        "buyer-sig": { type: "string" },
        "fee-payer": { type: "string" },
    },
});
if (!values.caller || !values["settlement-tx"] || !values["settlement-index"] ||
    !values["seller-claim"] || !values["ticket-timestamp"] || !values["buyer-sig"]) {
    process.stderr.write(JSON.stringify({
        error: "--caller, --settlement-tx, --settlement-index, --seller-claim, --ticket-timestamp, and --buyer-sig are required",
    }) + "\n");
    process.exit(1);
}
const body: Record<string, unknown> = {
    caller_lock_args: values.caller,
    settlement_tx_hash: values["settlement-tx"],
    settlement_index: Number(values["settlement-index"]),
    seller_claim_udt: values["seller-claim"],
    ticket_timestamp: values["ticket-timestamp"],
    buyer_sig: values["buyer-sig"],
};
if (values["fee-payer"])
    body["fee_payer_lock_args"] = values["fee-payer"];
const res = await fetch(`${MCP_URL}/transactions/build/dispute`, {
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
//# sourceMappingURL=initiate_dispute.mjs.map
