#!/usr/bin/env -S npx tsx
// Build a final payout transaction after the dispute window has expired.
//
// Usage:  npx tsx build_payout.mjs \
//           --caller           <lock_args> \
//           --settlement-tx    <0x...> \
//           --settlement-index <n> \
// Output: JSON with { tx, tx_hash, signing_message }
//
// Environment:
//   MCP_URL (default: http://localhost:3000)
//
// Notes:
//   This script imports TypeScript source from `ckb_payspace_mcp`, so it is
//   executed through `tsx` even though this file is `.mjs`.
import { parseArgs } from "node:util";
import { buildFinalPayout, attachFuelPreflight } from "ckb_payspace_mcp/src/builder.ts";
const { values } = parseArgs({
  options: {
    caller: { type: "string" },
    "settlement-tx": { type: "string" },
    "settlement-index": { type: "string" },
  },
});
if (!values.caller || !values["settlement-tx"] || !values["settlement-index"]) {
  process.stderr.write(JSON.stringify({ error: "--caller, --settlement-tx, and --settlement-index are required" }) + "\n");
  process.exit(1);
}
try {
  const built = await buildFinalPayout(String(values.caller), {
    settlement_tx_hash: String(values["settlement-tx"]),
    settlement_index: Number(values["settlement-index"]),
  });
  const data = await attachFuelPreflight(built, String(values.caller));
  const fuel =
    data && typeof data === "object" && !Array.isArray(data) &&
      data["fuel"] && typeof data["fuel"] === "object" && !Array.isArray(data["fuel"])
      ? data["fuel"]
      : null;
  if (fuel && fuel["sufficient"] !== true) {
    process.stderr.write(JSON.stringify({ error: "insufficient_fuel", fuel }) + "\n");
    process.exit(2);
  }
  console.log(JSON.stringify(data));
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}

