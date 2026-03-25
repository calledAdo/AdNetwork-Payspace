#!/usr/bin/env -S npx tsx
// Build a UDT settlement cell (payment channel opening).
// Returns { tx, tx_hash, signing_message } for the agent to sign and submit.
//
// Usage:  npx tsx open_channel.mts \
//           --buyer         <lock_args> \
//           --seller        <lock_args> \
//           --udt-type-args <0x...> \
//           --amount        <udt_units> \
//           [--fee-payer    <lock_args>]   # injects a fee-tank cell; defaults to
//                                          # collecting fees from the buyer's own cells
//
// If --fee-payer is given the MCP picks one plain CKB cell from that lock, computes
// the real fee from the serialized tx size × on-chain fee rate, and adds an exact
// change output back.  Without it the builder uses a 2 CKB static estimate.
//
// Environment:
//   MCP_URL (default: http://localhost:3000)
import { parseArgs } from "node:util";
const MCP_URL = process.env["MCP_URL"] ?? "http://localhost:3000";
const { values } = parseArgs({
    options: {
        buyer: { type: "string" },
        seller: { type: "string" },
        "udt-type-args": { type: "string" },
        amount: { type: "string" },
        "fee-payer": { type: "string" },
    },
});
if (!values.buyer || !values.seller || !values["udt-type-args"] || !values.amount) {
    process.stderr.write(JSON.stringify({ error: "--buyer, --seller, --udt-type-args, and --amount are required" }) + "\n");
    process.exit(1);
}
const body: Record<string, unknown> = {
    buyer_lock_args: values.buyer,
    seller_lock_args: values.seller,
    udt_type_args: values["udt-type-args"],
    udt_amount: values.amount,
};
if (values["fee-payer"])
    body["fee_payer_lock_args"] = values["fee-payer"];
const res = await fetch(`${MCP_URL}/transactions/build/settlement`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
});
const data = await res.json();
if (!res.ok) {
    process.stderr.write(JSON.stringify(data) + "\n");
    process.exit(1);
}
const fuel =
    data && typeof data === "object" && !Array.isArray(data) &&
        data["fuel"] && typeof data["fuel"] === "object" && !Array.isArray(data["fuel"])
        ? data["fuel"]
        : null;
if (fuel && fuel["sufficient"] !== true) {
    process.stderr.write(JSON.stringify({
        error: "insufficient_fuel",
        fuel,
    }) + "\n");
    process.exit(2);
}
console.log(JSON.stringify(data));
//# sourceMappingURL=open_channel.mjs.map
