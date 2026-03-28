#!/usr/bin/env node
// Fetch metrics for a snippet_id or booking_id.
//
// Usage:
//   node get_metrics.mjs --id <metric_id>
//
// Environment:
//   TRACKING_URL (default: http://localhost:4000)
import { parseArgs } from "node:util";
import { skillsConfig } from "../../config.js";

const TRACKING_URL = skillsConfig.trackingUrl;

const { values } = parseArgs({
  options: {
    id: { type: "string" },
  },
});

if (!values.id) {
  process.stderr.write(JSON.stringify({ error: "--id is required" }) + "\n");
  process.exit(1);
}

try {
  const metricId = encodeURIComponent(String(values.id));
  const response = await fetch(
    `${TRACKING_URL.replace(/\/+$/, "")}/tracking/stats/${metricId}`,
  );
  const data = await response.json();
  if (!response.ok) {
    process.stderr.write(
      JSON.stringify({
        error: "metrics fetch failed",
        status: response.status,
        detail: data,
      }) + "\n",
    );
    process.exit(1);
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
