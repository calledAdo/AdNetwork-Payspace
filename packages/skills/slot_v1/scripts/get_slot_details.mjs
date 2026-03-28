#!/usr/bin/env node
// Return the seller-managed slot payload for a given published placement
// outpoint, using the seller slot memory as the source of truth.
//
// Usage:
//   node get_slot_details.mjs --placement-tx-hash <0x...> --placement-index <n>
//
// Environment:
//   AGENT_DIR path to the seller workspace (required)
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { skillsConfig } from "../../config.js";

const AGENT_DIR = skillsConfig.agentDir;
if (!AGENT_DIR) {
  process.stderr.write(JSON.stringify({ error: "AGENT_DIR environment variable is not set" }) + "\n");
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    "placement-tx-hash": { type: "string" },
    "placement-index": { type: "string" },
  },
});

if (!values["placement-tx-hash"] || !values["placement-index"]) {
  process.stderr.write(JSON.stringify({
    error: "--placement-tx-hash and --placement-index are required",
  }) + "\n");
  process.exit(1);
}

const placementId = `${values["placement-tx-hash"]}:${Number(values["placement-index"])}`;
const slotsPath = path.join(AGENT_DIR, "memory", "slots.json");

const slots = (() => {
  try {
    const raw = fs.readFileSync(slotsPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
})();

const slot = slots.find((entry) => {
  const publication = entry?.publication;
  return publication && typeof publication === "object" && !Array.isArray(publication) &&
    publication.placement_id === placementId;
});

if (!slot) {
  process.stderr.write(JSON.stringify({
    error: "slot not found for placement",
    placement_id: placementId,
  }) + "\n");
  process.exit(1);
}

const slotDetails =
  slot.slot_details && typeof slot.slot_details === "object" && !Array.isArray(slot.slot_details)
    ? slot.slot_details
    : null;

if (!slotDetails) {
  process.stderr.write(JSON.stringify({
    error: "slot has no stored slot_details payload",
    placement_id: placementId,
  }) + "\n");
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  placement_id: placementId,
  snippet_id: slot.snippet_id ?? null,
  ...slotDetails,
}));

