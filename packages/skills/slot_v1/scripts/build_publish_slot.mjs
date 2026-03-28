#!/usr/bin/env -S npx tsx
// Build a BookingSpace publish transaction from explicit placement parameters.
// This script does not read slot memory, sign, submit, or persist state.
//
// Usage:
//   npx tsx build_publish_slot.mjs \
//     --seller-lock-args <0x...20bytes> \
//     --seller-pubkey <0x...33bytes> \
//     --price-per-mille <udt_per_mille> \
//     --ad-position <0|1|2|3> \
//     --publication-mode <0|1|MANUAL|SNIPPET_MANAGED> \
//     --keyword-flags <uint32> \
//     --gateway-url <https://...>
//
// Notes:
//   This script imports TypeScript source from `ckb_payspace_mcp`, so it is
//   executed through `tsx` even though this file is `.mjs`.
import { parseArgs } from "node:util";
import { buildPublishPlacement, attachFuelPreflight } from "ckb_payspace_mcp/src/builder.ts";

const { values } = parseArgs({
  options: {
    "seller-lock-args": { type: "string" },
    "seller-pubkey": { type: "string" },
    "price-per-mille": { type: "string" },
    "ad-position": { type: "string" },
    "publication-mode": { type: "string" },
    "keyword-flags": { type: "string" },
    "gateway-url": { type: "string" },
  },
});

const required = [
  "seller-lock-args",
  "seller-pubkey",
  "price-per-mille",
  "ad-position",
  "publication-mode",
  "keyword-flags",
  "gateway-url",
];

for (const key of required) {
  if (!values[key]) {
    process.stderr.write(JSON.stringify({ error: `--${key} is required` }) + "\n");
    process.exit(1);
  }
}

try {
  const built = await buildPublishPlacement(String(values["seller-lock-args"]), {
    seller_pubkey: String(values["seller-pubkey"]),
    price_per_mille: String(values["price-per-mille"]),
    ad_position: Number(values["ad-position"]),
    publication_mode: Number(values["publication-mode"]),
    keyword_flags: String(values["keyword-flags"]),
    gateway_url: String(values["gateway-url"]),
  });
  const data = await attachFuelPreflight(built, String(values["seller-lock-args"]));
  console.log(JSON.stringify(data));
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}
