#!/usr/bin/env -S npx tsx
// Build a cooperative channel close transaction.
// Both parties have agreed on the final UDT split off-chain; this commits it.
//
// Step 1 (get signing message): omit --buyer-sig and --seller-sig
// Step 4 (final submittable tx): pass both sigs
//
// Usage:  npx tsx build_close.mjs \
//           --caller           <lock_args> \
//           --settlement-tx    <0x...> \
//           --settlement-index <n> \
//           --seller-udt       <units> \
//           --buyer-udt        <units> \
//           [--buyer-sig       <0x...65bytes>] \
//           [--seller-sig      <0x...65bytes>] \
// Output: JSON with { tx, tx_hash, signing_message, coop_signing_message }
//
// Environment:
//   MCP_URL (default: http://localhost:3000)
//
// Notes:
//   This script imports TypeScript source from `ckb_payspace_mcp`, so it is
//   executed through `tsx` even though this file is `.mjs`.
import { parseArgs } from "node:util";
import { buildCoopClose, attachFuelPreflight } from "ckb_payspace_mcp/src/builder.ts";
const { values } = parseArgs({
  options: {
    caller: { type: "string" },
    "settlement-tx": { type: "string" },
    "settlement-index": { type: "string" },
    "seller-udt": { type: "string" },
    "buyer-udt": { type: "string" },
    "buyer-sig": { type: "string" },
    "seller-sig": { type: "string" },
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
try {
  const built = await buildCoopClose(String(values.caller), {
    settlement_tx_hash: String(values["settlement-tx"]),
    settlement_index: Number(values["settlement-index"]),
    seller_udt: String(values["seller-udt"]),
    buyer_udt: String(values["buyer-udt"]),
    buyer_sig: String(values["buyer-sig"] ?? ZERO_SIG),
    seller_sig: String(values["seller-sig"] ?? ZERO_SIG),
  });
  const data = await attachFuelPreflight(built, String(values.caller));
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
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}

