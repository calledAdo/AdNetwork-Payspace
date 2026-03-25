#!/usr/bin/env -S npx tsx
// Build a cooperative channel close transaction.
// Both parties have agreed on the final UDT split off-chain; this commits it.
//
// Step 1 (get signing message): omit --buyer-sig and --seller-sig
// Step 4 (final submittable tx): pass both sigs
//
// Usage:  npx tsx coop_close.mts \
//           --caller           <lock_args> \
//           --settlement-tx    <0x...> \
//           --settlement-index <n> \
//           --seller-udt       <units> \
//           --buyer-udt        <units> \
//           [--buyer-sig       <0x...65bytes>] \
//           [--seller-sig      <0x...65bytes>] \
//           [--fee-payer       <lock_args>]     # inject fee-tank cell at exact on-chain rate
// Output: JSON with { tx, tx_hash, signing_message, coop_signing_message }
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
        "seller-udt": { type: "string" },
        "buyer-udt": { type: "string" },
        "buyer-sig": { type: "string" },
        "seller-sig": { type: "string" },
        "fee-payer": { type: "string" },
    },
});
if (!values.caller || !values["settlement-tx"] || !values["settlement-index"] ||
    !values["seller-udt"] || !values["buyer-udt"]) {
    process.stderr.write(JSON.stringify({
        error: "--caller, --settlement-tx, --settlement-index, --seller-udt, and --buyer-udt are required",
    }) + "\n");
    process.exit(1);
}
const ZERO_SIG = "0x" + "00".repeat(65);
const body: Record<string, unknown> = {
    caller_lock_args: values.caller,
    settlement_tx_hash: values["settlement-tx"],
    settlement_index: Number(values["settlement-index"]),
    seller_udt: values["seller-udt"],
    buyer_udt: values["buyer-udt"],
    buyer_sig: values["buyer-sig"] ?? ZERO_SIG,
    seller_sig: values["seller-sig"] ?? ZERO_SIG,
};
if (values["fee-payer"])
    body["fee_payer_lock_args"] = values["fee-payer"];
const res = await fetch(`${MCP_URL}/transactions/build/coop-close`, {
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
//# sourceMappingURL=coop_close.mjs.map
