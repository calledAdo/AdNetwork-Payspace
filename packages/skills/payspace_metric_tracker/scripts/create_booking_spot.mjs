#!/usr/bin/env node
// Register a booking spot and receive tracked URLs.
//
// Usage:
//   node create_booking_spot.mjs \
//     --destination-url "https://example.com" \
//     --image-url "https://cdn.example/ad.png"
//
// Environment:
//   TRACKING_URL (default: http://localhost:4000)
import { parseArgs } from "node:util";
import { skillsConfig } from "../../config.js";

const TRACKING_URL = skillsConfig.trackingUrl;

const { values } = parseArgs({
  options: {
    "destination-url": { type: "string" },
    "image-url": { type: "string" },
    "tracked-image-url": { type: "string" },
    "tracked-click-url": { type: "string" },
  },
});

if (!values["destination-url"] || !values["image-url"]) {
  process.stderr.write(
    JSON.stringify({
      error: "--destination-url and --image-url are required",
    }) + "\n",
  );
  process.exit(1);
}

const body = {
  destination_url: String(values["destination-url"]),
  image_url: String(values["image-url"]),
  tracked_image_url: values["tracked-image-url"]
    ? String(values["tracked-image-url"])
    : undefined,
  tracked_click_url: values["tracked-click-url"]
    ? String(values["tracked-click-url"])
    : undefined,
};

try {
  const response = await fetch(
    `${TRACKING_URL.replace(/\/+$/, "")}/tracking/bookings/register`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = await response.json();
  if (!response.ok) {
    process.stderr.write(
      JSON.stringify({
        error: "booking registration failed",
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
