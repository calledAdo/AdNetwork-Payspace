#!/usr/bin/env node
// Fetch snippet details and tracking metadata.
//
// Usage:
//   node get_snippet.mjs --snippet-id <snip_xxx>
//
// Environment:
//   TRACKING_URL (default: http://localhost:4000)
import { parseArgs } from "node:util";
import { skillsConfig } from "../../config.js";

const TRACKING_URL = skillsConfig.trackingUrl;

const { values } = parseArgs({
  options: {
    "snippet-id": { type: "string" },
  },
});

if (!values["snippet-id"]) {
  process.stderr.write(
    JSON.stringify({ error: "--snippet-id is required" }) + "\n",
  );
  process.exit(1);
}

try {
  const snippetId = encodeURIComponent(String(values["snippet-id"]));
  const response = await fetch(
    `${TRACKING_URL.replace(/\/+$/, "")}/snippets/${snippetId}`,
  );
  const data = await response.json();
  if (!response.ok) {
    process.stderr.write(
      JSON.stringify({
        error: "snippet fetch failed",
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
