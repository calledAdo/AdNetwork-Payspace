#!/usr/bin/env -S npx tsx
// Build a final payout transaction after the dispute window has expired.
//
// Usage:  npx tsx build_payout.mts \
//           --caller           <lock_args> \
//           --settlement-tx    <0x...> \
//           --settlement-index <n> \
//           [--fee-payer       <lock_args>]   # inject fee-tank cell at exact on-chain rate
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
        "fee-payer": { type: "string" },
    },
});
if (!values.caller || !values["settlement-tx"] || !values["settlement-index"]) {
    process.stderr.write(JSON.stringify({ error: "--caller, --settlement-tx, and --settlement-index are required" }) + "\n");
    process.exit(1);
}
const body: Record<string, unknown> = {
    caller_lock_args: values.caller,
    settlement_tx_hash: values["settlement-tx"],
    settlement_index: Number(values["settlement-index"]),
};
if (values["fee-payer"])
    body["fee_payer_lock_args"] = values["fee-payer"];
const res = await fetch(`${MCP_URL}/transactions/build/payout`, {
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
//# sourceMappingURL=build_payout.mjs.map
