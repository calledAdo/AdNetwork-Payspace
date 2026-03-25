#!/usr/bin/env -S npx tsx
// Fetch a single placement cell and its buyer-side tracking stats.
//
// Usage:  npx tsx check_placement.mts --tx-hash <0x...> --index <n> [--booking-id <book_...>]
// Output: JSON with { placement, stats }
//
// Environment:
//   MCP_URL      (default: http://localhost:3000)
//   TRACKING_URL (optional — stats will be zeroed if unset)
import { parseArgs } from "node:util";
const MCP_URL = process.env["MCP_URL"] ?? "http://localhost:3000";
const TRACKING_URL = process.env["TRACKING_URL"] ?? "";
const { values } = parseArgs({
    options: {
        "tx-hash": { type: "string" },
        index: { type: "string" },
        "booking-id": { type: "string" },
    },
});
if (!values["tx-hash"] || !values.index) {
    process.stderr.write(JSON.stringify({ error: "--tx-hash and --index are required" }) + "\n");
    process.exit(1);
}
const txHash = values["tx-hash"];
const index = values.index;
const placementId = `${txHash}:${index}`;
const statsMetricId = values["booking-id"] ?? placementId;
const placementRes = await fetch(`${MCP_URL}/placements/${txHash}/${index}`);
const placement = await placementRes.json();
if (!placementRes.ok) {
    process.stderr.write(JSON.stringify(placement) + "\n");
    process.exit(1);
}
let stats = { impressions: 0, clicks: 0, ctr: 0 };
if (TRACKING_URL) {
    try {
        const r = await fetch(`${TRACKING_URL}/stats/${encodeURIComponent(statsMetricId)}`);
        if (r.ok)
            stats = await r.json();
    }
    catch { /* leave default zeros */ }
}
console.log(JSON.stringify({ placement, stats_metric_id: statsMetricId, stats }));
//# sourceMappingURL=check_placement.mjs.map
