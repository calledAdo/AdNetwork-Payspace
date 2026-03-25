#!/usr/bin/env -S npx tsx
// Check the liveness of a settlement cell (payment channel).
// Returns the live cell data including decoded lock args and UDT amount.
//
// Usage:  npx tsx check_channel.mts \
//           --settlement-tx    <0x...> \
//           --settlement-index <n>
// Output: JSON from GET /cells/live
//
// Environment:
//   MCP_URL (default: http://localhost:3000)
import { parseArgs } from "node:util";
const MCP_URL = process.env["MCP_URL"] ?? "http://localhost:3000";
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
const params = new URLSearchParams({
    tx_hash: values["settlement-tx"],
    index: values["settlement-index"],
});
const res = await fetch(`${MCP_URL}/cells/live?${params}`);
const data = await res.json();
if (!res.ok) {
    process.stderr.write(JSON.stringify(data) + "\n");
    process.exit(1);
}
console.log(JSON.stringify(data));
//# sourceMappingURL=check_channel.mjs.map