#!/usr/bin/env node
// Sign and submit snippet content update.
//
// Usage:
//   node update_snippet_content.mjs \
//     --snippet-id snip_xxx \
//     --version 1 \
//     --image-url "https://cdn.example/ad.png" \
//     --destination-url "https://example.com" \
//     [--writeup "optional text"]
//
// Environment:
//   TRACKING_URL (default: http://localhost:4000)
//   PRIVATE_KEY  (required) hex secp256k1 private key
import crypto from "node:crypto";
import { parseArgs } from "node:util";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { skillsConfig } from "../../config.js";

const TRACKING_URL = skillsConfig.trackingUrl;
const PRIVATE_KEY = skillsConfig.privateKey;

if (!PRIVATE_KEY) {
  process.stderr.write(JSON.stringify({ error: "PRIVATE_KEY not set" }) + "\n");
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    "snippet-id": { type: "string" },
    version: { type: "string" },
    "image-url": { type: "string" },
    "destination-url": { type: "string" },
    writeup: { type: "string" },
  },
});

if (!values["snippet-id"] || !values.version) {
  process.stderr.write(
    JSON.stringify({
      error: "--snippet-id and --version are required",
    }) + "\n",
  );
  process.exit(1);
}

const payload = {
  snippet_id: String(values["snippet-id"]),
  version: Number(values.version),
  image_url: values["image-url"] ? String(values["image-url"]) : null,
  destination_url: values["destination-url"]
    ? String(values["destination-url"])
    : null,
  writeup: values.writeup ? String(values.writeup) : null,
};

if (!Number.isInteger(payload.version) || payload.version < 1) {
  process.stderr.write(
    JSON.stringify({ error: "--version must be an integer >= 1" }) + "\n",
  );
  process.exit(1);
}

function canonicalize(value) {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${canonicalize(val)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

const hash = crypto.createHash("sha256").update(canonicalize(payload)).digest();
const raw = secp256k1.sign(hash, Buffer.from(PRIVATE_KEY, "hex"), {
  prehash: false,
  format: "recovered",
});
const signature =
  "0x" +
  Buffer.concat([
    Buffer.from(raw.slice(1, 33)),
    Buffer.from(raw.slice(33, 65)),
    Buffer.from(raw.slice(0, 1)),
  ]).toString("hex");

try {
  const snippetId = encodeURIComponent(payload.snippet_id);
  const response = await fetch(
    `${TRACKING_URL.replace(/\/+$/, "")}/snippets/${snippetId}/content`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...payload,
        signature,
      }),
    },
  );
  const data = await response.json();
  if (!response.ok) {
    process.stderr.write(
      JSON.stringify({
        error: "snippet content update failed",
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
