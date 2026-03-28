#!/usr/bin/env node
// Create or update one placement entry in memory/placements.json using an
// atomic write so other processes never observe a partial file.
//
// Usage: node upsert_placement.mjs \
//          --placement-id <tx_hash:index> \
//          --patch-json   '{"state":"negotiating"}' \
//          [--create-if-missing <true|false>]
// Output: JSON with the updated placement and placement count
//
// Environment:
//   AGENT_DIR path to the agent workspace (required)
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { BuyerPlacementSchema, BuyerPlacementsFileSchema } from "./memory_schema_buyer.mjs";
import { skillsConfig } from "../../config.js";

const AGENT_DIR = skillsConfig.agentDir;
if (!AGENT_DIR) {
  process.stderr.write(JSON.stringify({ error: "AGENT_DIR environment variable is not set" }) + "\n");
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    "placement-id": { type: "string" },
    "patch-json": { type: "string" },
    "create-if-missing": { type: "string" },
  },
});

if (!values["placement-id"] || !values["patch-json"]) {
  process.stderr.write(JSON.stringify({
    error: "--placement-id and --patch-json are required",
  }) + "\n");
  process.exit(1);
}

const createIfMissing = values["create-if-missing"] !== "false";
const placementsPath = path.join(AGENT_DIR, "memory", "placements.json");

function readPlacements() {
  try {
    const raw = fs.readFileSync(placementsPath, "utf8");
    const parsed = JSON.parse(raw);
    const validated = BuyerPlacementsFileSchema.safeParse(parsed);
    if (!validated.success) return [];
    return validated.data;
  } catch {
    return [];
  }
}

function writePlacementsAtomic(placements) {
  const validated = BuyerPlacementsFileSchema.safeParse(placements);
  if (!validated.success) {
    throw new Error(validated.error.issues.map((issue) => issue.message).join("; "));
  }
  const tempPath = `${placementsPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(validated.data, null, 2));
  fs.renameSync(tempPath, placementsPath);
}

function deepMergePlacement(current, patch) {
  const merged = { ...current, ...patch };
  const currentTaskIds = current["task_ids"];
  const patchTaskIds = patch["task_ids"];
  if (
    currentTaskIds && typeof currentTaskIds === "object" && !Array.isArray(currentTaskIds) &&
    patchTaskIds && typeof patchTaskIds === "object" && !Array.isArray(patchTaskIds)
  ) {
    merged["task_ids"] = { ...currentTaskIds, ...patchTaskIds };
  }
  return merged;
}

let patch;
try {
  const parsed = JSON.parse(values["patch-json"]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("patch must be a JSON object");
  }
  patch = parsed;
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: "invalid --patch-json",
    detail: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}

const placementId = values["placement-id"];
const placements = readPlacements();
const index = placements.findIndex((entry) => entry["placement_id"] === placementId);

let updatedPlacement;
if (index === -1) {
  if (!createIfMissing) {
    process.stderr.write(JSON.stringify({
      error: "placement not found",
      placement_id: placementId,
    }) + "\n");
    process.exit(1);
  }
  updatedPlacement = deepMergePlacement({ placement_id: placementId }, patch);
  const validated = BuyerPlacementSchema.safeParse(updatedPlacement);
  if (!validated.success) {
    process.stderr.write(JSON.stringify({
      error: "updated placement failed validation",
      issues: validated.error.issues,
    }) + "\n");
    process.exit(1);
  }
  updatedPlacement = validated.data;
  placements.push(updatedPlacement);
} else {
  updatedPlacement = deepMergePlacement(placements[index] ?? {}, patch);
  const validated = BuyerPlacementSchema.safeParse(updatedPlacement);
  if (!validated.success) {
    process.stderr.write(JSON.stringify({
      error: "updated placement failed validation",
      issues: validated.error.issues,
    }) + "\n");
    process.exit(1);
  }
  updatedPlacement = validated.data;
  placements[index] = updatedPlacement;
}

fs.mkdirSync(path.dirname(placementsPath), { recursive: true });
try {
  writePlacementsAtomic(placements);
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: "placements file failed validation",
    detail: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  placement: updatedPlacement,
  count: placements.length,
}));
