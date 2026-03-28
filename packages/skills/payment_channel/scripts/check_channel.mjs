#!/usr/bin/env -S npx tsx
// Check the liveness of a settlement cell (payment channel).
// Returns the live cell data including decoded lock args and UDT amount.
//
// Usage:  npx tsx check_channel.mjs \
//           --settlement-tx    <0x...> \
//           --settlement-index <n>
// Output: JSON from GET /cells/live
//
// Environment:
//   MCP_URL (default: http://localhost:3000)
//
// Notes:
//   This script imports TypeScript source from `ckb_payspace_mcp`, so it is
//   executed through `tsx` even though this file is `.mjs`.
import { parseArgs } from "node:util";
import { getLiveCell } from "ckb_payspace_mcp/src/ckb.ts";
const { values } = parseArgs({
  options: {
    "settlement-tx": { type: "string" },
    "settlement-index": { type: "string" },
  },
});
if (!values["settlement-tx"] || !values["settlement-index"]) {
  process.stderr.write(JSON.stringify({ error: "--settlement-tx and --settlement-index are required" }) + "\n");
  process.exit(1);
}
try {
  const index = Number(values["settlement-index"]);
  const data = await getLiveCell({
    tx_hash: String(values["settlement-tx"]),
    index: `0x${index.toString(16)}`,
  });
  console.log(JSON.stringify(data ?? { live: false }));
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}

