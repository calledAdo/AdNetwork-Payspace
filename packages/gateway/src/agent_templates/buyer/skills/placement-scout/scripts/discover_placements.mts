#!/usr/bin/env -S npx tsx
// Discover available placement cells matching campaign requirements.
// Returns cells with status=0 (available) only.
//
// Usage:  npx tsx discover_placements.mts \
//           [--keyword-flags <uint32>] \
//           [--max-price     <udt_per_mille>] \
//           [--ad-position   <0|1|2|3>] \
//           [--limit         <n>]
// Output: JSON array of placement objects.
//
// Environment:
//   MCP_URL (default: http://localhost:3000)
import { parseArgs } from "node:util";
const MCP_URL = process.env["MCP_URL"] ?? "http://localhost:3000";
const { values } = parseArgs({
    options: {
        "keyword-flags": { type: "string" },
        "max-price": { type: "string" },
        "ad-position": { type: "string" },
        limit: { type: "string" },
    },
});
const params = new URLSearchParams({ status: "0", limit: values.limit ?? "50" });
if (values["keyword-flags"])
    params.set("keyword_flags", values["keyword-flags"]);
if (values["max-price"])
    params.set("max_price", values["max-price"]);
if (values["ad-position"])
    params.set("ad_position", values["ad-position"]);
const res = await fetch(`${MCP_URL}/discover/placements?${params}`);
const data = await res.json();
if (!res.ok) {
    process.stderr.write(JSON.stringify(data) + "\n");
    process.exit(1);
}
console.log(JSON.stringify(data));
//# sourceMappingURL=discover_placements.mjs.map