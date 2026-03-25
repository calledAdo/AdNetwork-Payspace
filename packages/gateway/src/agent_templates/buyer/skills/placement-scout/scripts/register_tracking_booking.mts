#!/usr/bin/env -S npx tsx
// Register buyer-side booking tracking and return the tracked asset URLs.
//
// Usage: npx tsx register_tracking_booking.mts \
//          --image-url <https://...> \
//          --click-url <https://...>
//
// Environment:
//   TRACKING_URL base tracking URL or backend base URL (required)
import { parseArgs } from "node:util";

const TRACKING_URL = process.env["TRACKING_URL"] ?? "";
if (!TRACKING_URL) {
  process.stderr.write(JSON.stringify({ error: "TRACKING_URL environment variable is not set" }) + "\n");
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    "image-url": { type: "string" },
    "click-url": { type: "string" },
  },
});

if (!values["image-url"] || !values["click-url"]) {
  process.stderr.write(JSON.stringify({
    error: "--image-url and --click-url are required",
  }) + "\n");
  process.exit(1);
}

function normalizeTrackingBase(raw: string): string {
  const url = new URL(raw);
  const current = url.pathname.replace(/\/+$/, "");
  url.pathname = current.endsWith("/tracking")
    ? (current || "/tracking")
    : `${current || ""}/tracking`;
  return url.toString().replace(/\/+$/, "");
}

const trackingBase = normalizeTrackingBase(TRACKING_URL);
const endpoint = `${trackingBase}/bookings/register`;

const payload = {
  image_url: values["image-url"],
  destination_url: values["click-url"],
};

let responseData: unknown;
let status = 0;
try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  status = response.status;
  responseData = await response.json();
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: "failed to register tracking booking",
    detail: err instanceof Error ? err.message : String(err),
    endpoint,
  }) + "\n");
  process.exit(1);
}

if (status >= 400) {
  process.stderr.write(JSON.stringify({
    error: "tracking registration failed",
    status,
    endpoint,
    response: responseData,
  }) + "\n");
  process.exit(1);
}

console.log(JSON.stringify({
  endpoint,
  response: responseData,
}));
