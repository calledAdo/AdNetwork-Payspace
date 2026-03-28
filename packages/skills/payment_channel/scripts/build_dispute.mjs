#!/usr/bin/env -S npx tsx
// Build a dispute transaction using the last valid off-chain payment ticket.
// Call this when the seller stops acknowledging tickets or goes silent.
//
// Usage:  npx tsx build_dispute.mjs \
//           --caller            <lock_args> \
//           --settlement-tx     <0x...> \
//           --settlement-index  <n> \
//           --seller-claim      <udt_units> \
//           --ticket-timestamp  <decimal_nonce> \
//           --buyer-sig         <0x...65bytes> \
// Output: JSON with { tx, tx_hash, signing_message }
//
// Environment:
//   MCP_URL (default: http://localhost:3000)
//
// Notes:
//   This script imports TypeScript source from `ckb_payspace_mcp`, so it is
//   executed through `tsx` even though this file is `.mjs`.
import { parseArgs } from "node:util";
import { buildDisputeTx, attachFuelPreflight } from "ckb_payspace_mcp/src/builder.ts";
const { values } = parseArgs({
  options: {
    caller: { type: "string" },
    "settlement-tx": { type: "string" },
    "settlement-index": { type: "string" },
    "seller-claim": { type: "string" },
    "ticket-timestamp": { type: "string" },
    "buyer-sig": { type: "string" },
  },
});
if (!values.caller || !values["settlement-tx"] || !values["settlement-index"] ||
  !values["seller-claim"] || !values["ticket-timestamp"] || !values["buyer-sig"]) {
  process.stderr.write(JSON.stringify({
    error: "--caller, --settlement-tx, --settlement-index, --seller-claim, --ticket-timestamp, and --buyer-sig are required",
  }) + "\n");
  process.exit(1);
}
try {
  const built = await buildDisputeTx(String(values.caller), {
    settlement_tx_hash: String(values["settlement-tx"]),
    settlement_index: Number(values["settlement-index"]),
    seller_claim_udt: String(values["seller-claim"]),
    ticket_timestamp: String(values["ticket-timestamp"]),
    buyer_sig: String(values["buyer-sig"]),
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

