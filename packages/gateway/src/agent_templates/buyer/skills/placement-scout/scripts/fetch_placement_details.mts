#!/usr/bin/env -S npx tsx
// Fetch and verify off-chain placement details.
// When the cell has IPFS data (ipfs_present=true), delegates to the MCP server
// which fetches from IPFS and verifies the blake2b hash against the on-chain cell.
// Falls back to the Payspace backend when IPFS data is absent.
//
// Usage:  npx tsx fetch_placement_details.mts \
//           --tx-hash       <0x...> \
//           --index         <n> \
//           [--placement-id <integration-specific-id>] \
//           [--ipfs-present  <true|false>]
// Output: JSON details blob
//
// Environment:
//   MCP_URL           (default: http://localhost:3000)
//   PAYSPACE_API_URL  (required when ipfs_present != true)
import { parseArgs } from "node:util";
const MCP_URL = process.env["MCP_URL"] ?? "http://localhost:3000";
const PAYSPACE_API_URL = process.env["PAYSPACE_API_URL"] ?? "";
const { values } = parseArgs({
    options: {
        "tx-hash": { type: "string" },
        index: { type: "string" },
        "placement-id": { type: "string" },
        "ipfs-present": { type: "string" },
    },
});
if (!values["tx-hash"] || !values.index) {
    process.stderr.write(JSON.stringify({ error: "--tx-hash and --index are required" }) + "\n");
    process.exit(1);
}
const txHash = values["tx-hash"];
const index = values.index;
const ipfsPresent = values["ipfs-present"] === "true";
const placementId = values["placement-id"] ?? `${txHash}:${index}`;
if (ipfsPresent) {
    const res = await fetch(`${MCP_URL}/placements/${txHash}/${index}/details`);
    const data = await res.json();
    if (!res.ok) {
        process.stderr.write(JSON.stringify(data) + "\n");
        process.exit(1);
    }
    console.log(JSON.stringify(data.details));
}
else if (PAYSPACE_API_URL) {
    const res = await fetch(`${PAYSPACE_API_URL}/placements/details/${encodeURIComponent(placementId)}`);
    const data = await res.json();
    if (!res.ok) {
        process.stderr.write(JSON.stringify(data) + "\n");
        process.exit(1);
    }
    console.log(JSON.stringify(data));
}
else {
    process.stderr.write(JSON.stringify({ error: "no IPFS data in cell and PAYSPACE_API_URL is not configured" }) + "\n");
    process.exit(1);
}
//# sourceMappingURL=fetch_placement_details.mjs.map
