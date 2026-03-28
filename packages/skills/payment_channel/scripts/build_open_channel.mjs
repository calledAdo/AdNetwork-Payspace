#!/usr/bin/env -S npx tsx
// Build a UDT settlement cell (payment channel opening).
// Returns { tx, tx_hash, signing_message } for the agent to sign and submit.
//
// Usage:  npx tsx build_open_channel.mjs \
//           --buyer         <lock_args> \
//           --seller        <lock_args> \
//           --udt-type-args <0x...> \
//           --amount        <udt_units> \
//           --amount        <udt_units>
//
// Environment:
//   MCP_URL (default: http://localhost:3000)
//
// Notes:
//   This script imports TypeScript source from `ckb_payspace_mcp`, so it is
//   executed through `tsx` even though this file is `.mjs`.
import { parseArgs } from "node:util";
import {
  buildOpenChannel,
  attachFuelPreflight,
} from "ckb_payspace_mcp/src/builder.ts";
const { values } = parseArgs({
  options: {
    buyer: { type: "string" },
    seller: { type: "string" },
    "udt-type-args": { type: "string" },
    amount: { type: "string" },
  },
});
if (
  !values.buyer ||
  !values.seller ||
  !values["udt-type-args"] ||
  !values.amount
) {
  process.stderr.write(
    JSON.stringify({
      error: "--buyer, --seller, --udt-type-args, and --amount are required",
    }) + "\n",
  );
  process.exit(1);
}
try {
  const built = await buildOpenChannel(String(values.buyer), {
    seller_lock_args: String(values.seller),
    udt_type_args: String(values["udt-type-args"]),
    udt_amount: String(values.amount),
  });
  const data = await attachFuelPreflight(built, String(values.buyer));
  const fuel =
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    data["fuel"] &&
    typeof data["fuel"] === "object" &&
    !Array.isArray(data["fuel"])
      ? data["fuel"]
      : null;
  if (fuel && fuel["sufficient"] !== true) {
    process.stderr.write(
      JSON.stringify({ error: "insufficient_fuel", fuel }) + "\n",
    );
    process.exit(2);
  }
  console.log(JSON.stringify(data));
} catch (err) {
  process.stderr.write(
    JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
    }) + "\n",
  );
  process.exit(1);
}
