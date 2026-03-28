#!/usr/bin/env -S npx tsx
// Build an xUDT transfer from one lock to another.
//
// Usage:
//   npx tsx build_withdraw_token.mjs --from <lock_args> --to <lock_args> --amount <udt>
//     [--udt-type-args <0x...>]
//
// Output:
//   JSON build result with tx/signing_message/fuel summary.
//
// Notes:
//   This script imports TypeScript source from `ckb_payspace_mcp`, so it is
//   executed through `tsx` even though this file is `.mjs`.
import { parseArgs } from "node:util";
import {
  buildUdtTransfer,
  attachFuelPreflight,
} from "ckb_payspace_mcp/src/builder.ts";
import { skillsConfig } from "../../config.js";

const { values } = parseArgs({
  options: {
    from: { type: "string" },
    to: { type: "string" },
    amount: { type: "string" },
    "udt-type-args": { type: "string" },
  },
});

if (!values.from || !values.to || !values.amount) {
  process.stderr.write(
    JSON.stringify({
      error: "--from, --to, and --amount are required",
    }) + "\n",
  );
  process.exit(1);
}

try {
  const resolvedUdt =
    values["udt-type-args"] ?? skillsConfig.defaultXudtTypeArgs ?? "";
  const built = await buildUdtTransfer(String(values.from), {
    to_lock_args: String(values.to),
    udt_amount: String(values.amount),
    udt_type_args: String(resolvedUdt),
  });
  const data = await attachFuelPreflight(built, String(values.from));

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
