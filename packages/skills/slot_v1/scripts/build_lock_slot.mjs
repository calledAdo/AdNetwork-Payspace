#!/usr/bin/env -S npx tsx
// Build a transaction that confirms a booking on an existing placement cell.
// Flips the cell status from available (0) to taken (1).
//
// Usage:  npx tsx build_lock_slot.mjs \
//           --seller      <lock_args> \
//           --tx-hash     <0x...> \
//           --index       <n> \
//           --channel-tx  <0x...>
//
// Notes:
//   This script imports TypeScript source from `ckb_payspace_mcp`, so it is
//   executed through `tsx` even though this file is `.mjs`.
import { parseArgs } from "node:util";
import { buildBookPlacement, attachFuelPreflight } from "ckb_payspace_mcp/src/builder.ts";

const { values } = parseArgs({
  options: {
    seller: { type: "string" },
    "tx-hash": { type: "string" },
    index: { type: "string" },
    "channel-tx": { type: "string" },
  },
});

if (!values.seller || !values["tx-hash"] || !values.index || !values["channel-tx"]) {
  process.stderr.write(JSON.stringify({ error: "--seller, --tx-hash, --index, and --channel-tx are required" }) + "\n");
  process.exit(1);
}

try {
  const built = await buildBookPlacement(String(values.seller), {
    placement_tx_hash: String(values["tx-hash"]),
    placement_index: Number(values.index),
    channel_tx_hash: String(values["channel-tx"]),
  });
  const data = await attachFuelPreflight(built, String(values.seller));
  console.log(JSON.stringify(data));
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}
