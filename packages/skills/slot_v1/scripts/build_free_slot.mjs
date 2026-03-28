#!/usr/bin/env -S npx tsx
// Build a cancel-booking transaction to reclaim a placement cell.
// Reverts the placement cell status back to available (0).
//
// Usage:  npx tsx build_free_slot.mjs \
//           --seller     <lock_args> \
//           --tx-hash    <0x...> \
//           --index      <n>
//
// Notes:
//   This script imports TypeScript source from `ckb_payspace_mcp`, so it is
//   executed through `tsx` even though this file is `.mjs`.
import { parseArgs } from "node:util";
import { buildCancelBooking, attachFuelPreflight } from "ckb_payspace_mcp/src/builder.ts";

const { values } = parseArgs({
  options: {
    seller: { type: "string" },
    "tx-hash": { type: "string" },
    index: { type: "string" },
  },
});

if (!values.seller || !values["tx-hash"] || !values.index) {
  process.stderr.write(JSON.stringify({ error: "--seller, --tx-hash, and --index are required" }) + "\n");
  process.exit(1);
}

try {
  const built = await buildCancelBooking(String(values.seller), {
    placement_tx_hash: String(values["tx-hash"]),
    placement_index: Number(values.index),
  });
  const data = await attachFuelPreflight(built, String(values.seller));
  console.log(JSON.stringify(data));
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}
