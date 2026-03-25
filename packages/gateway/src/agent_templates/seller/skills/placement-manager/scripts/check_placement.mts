#!/usr/bin/env -S npx tsx
// Fetch a placement cell and its tracking stats.
// Outputs: { placement, stats }
//
// Usage:  npx tsx check_placement.mts --tx-hash <0x...> --index <n>
//
// Environment:
//   MCP_URL      (default: http://localhost:3000)
//   TRACKING_URL (optional — stats will be empty if unset)
import { parseArgs } from "node:util";
const MCP_URL = process.env["MCP_URL"] ?? "http://localhost:3000";
const TRACKING_URL = process.env["TRACKING_URL"] ?? "";
const { values } = parseArgs({
    options: {
        "tx-hash": { type: "string" },
        index: { type: "string" },
    },
});
if (!values["tx-hash"] || !values.index) {
    process.stderr.write(JSON.stringify({ error: "--tx-hash and --index are required" }) + "\n");
    process.exit(1);
}
const txHash = values["tx-hash"];
const index = values.index;
const slotId = `${txHash}:${index}`;
const placementRes = await fetch(`${MCP_URL}/placements/${txHash}/${index}`);
const placement = await placementRes.json();
if (!placementRes.ok) {
    process.stderr.write(JSON.stringify(placement) + "\n");
    process.exit(1);
}
let stats = {};
if (TRACKING_URL) {
    try {
        const r = await fetch(`${TRACKING_URL}/stats/${slotId}`);
        if (r.ok)
            stats = await r.json();
    }
    catch { /* leave empty */ }
}
console.log(JSON.stringify({ placement, stats }));
//# sourceMappingURL=check_placement.mjs.map