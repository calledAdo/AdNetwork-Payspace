#!/usr/bin/env -S npx tsx
// Persist a full seller-managed slot payload into seller memory in the grouped
// slot-state format expected by the current seller template.
//
// Usage: npx tsx register_slot.mts --slot-json '{...}'
//
// Environment:
//   AGENT_DIR path to the seller workspace (required)
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { SellerSlotSchema, SellerSlotsFileSchema, SellerStatsSchema } from "../../../scripts/memory_schema.mjs";

type JsonRecord = Record<string, unknown>;

const AGENT_DIR = process.env["AGENT_DIR"];
if (!AGENT_DIR) {
  process.stderr.write(JSON.stringify({ error: "AGENT_DIR environment variable is not set" }) + "\n");
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    "slot-json": { type: "string" },
  },
});

if (!values["slot-json"]) {
  process.stderr.write(JSON.stringify({ error: "--slot-json is required" }) + "\n");
  process.exit(1);
}

const slotInput = JSON.parse(values["slot-json"]) as JsonRecord;
const snippetId = typeof slotInput["snippet_id"] === "string" ? slotInput["snippet_id"] : "";
if (!snippetId) {
  process.stderr.write(JSON.stringify({ error: "slot payload must include snippet_id" }) + "\n");
  process.exit(1);
}

const memoryDir = path.join(AGENT_DIR, "memory");
const slotsPath = path.join(memoryDir, "slots.json");
const statsPath = path.join(memoryDir, "stats.json");

function readJsonArray(filePath: string): JsonRecord[] {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const validated = SellerSlotsFileSchema.safeParse(parsed);
    if (!validated.success) return [];
    return validated.data as JsonRecord[];
  } catch {
    return [];
  }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const validated = SellerSlotsFileSchema.safeParse(value);
  if (!validated.success) {
    throw new Error(validated.error.issues.map((issue) => issue.message).join("; "));
  }
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(validated.data, null, 2));
  fs.renameSync(tempPath, filePath);
}

function nowIso(): string {
  return new Date().toISOString();
}

const slots = readJsonArray(slotsPath);
const existingIndex = slots.findIndex((slot) => slot["snippet_id"] === snippetId);
const existing = existingIndex >= 0 ? slots[existingIndex] ?? {} : {};

const slotRecord: JsonRecord = {
  snippet_id: snippetId,
  state: typeof existing["state"] === "string" ? existing["state"] : "awaiting_install",
  slot_details: {
    owner_pubkey: slotInput["owner_pubkey"] ?? null,
    page_url: slotInput["page_url"] ?? null,
    dimensions: slotInput["dimensions"] ?? null,
    min_amount_per_1000: slotInput["min_amount_per_1000"] ?? "0",
    ad_position: slotInput["ad_position"] ?? 0,
    publication_mode: slotInput["publication_mode"] ?? 1,
    keyword_flags: slotInput["keyword_flags"] ?? "0",
    policy_text: slotInput["policy_text"] ?? null,
    metadata:
      slotInput["metadata"] && typeof slotInput["metadata"] === "object" && !Array.isArray(slotInput["metadata"])
        ? slotInput["metadata"]
        : {},
  },
  publication:
    existing["publication"] && typeof existing["publication"] === "object" && !Array.isArray(existing["publication"])
      ? existing["publication"]
      : {},
  correlation_map:
    existing["correlation_map"] && typeof existing["correlation_map"] === "object" && !Array.isArray(existing["correlation_map"])
      ? existing["correlation_map"]
      : {},
  current_booking:
    existing["current_booking"] && typeof existing["current_booking"] === "object" && !Array.isArray(existing["current_booking"])
      ? existing["current_booking"]
      : null,
  history: Array.isArray(existing["history"]) ? existing["history"] : [],
  updated_at: nowIso(),
};

const validatedSlot = SellerSlotSchema.safeParse(slotRecord);
if (!validatedSlot.success) {
  process.stderr.write(JSON.stringify({
    error: "slot record failed validation",
    issues: validatedSlot.error.issues,
  }) + "\n");
  process.exit(1);
}

if (existingIndex >= 0) {
  slots[existingIndex] = validatedSlot.data as JsonRecord;
} else {
  slots.push(validatedSlot.data as JsonRecord);
}

fs.mkdirSync(memoryDir, { recursive: true });
try {
  writeJsonAtomic(slotsPath, slots);
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: "slots file failed validation",
    detail: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}

const stats = (() => {
  try {
    return JSON.parse(fs.readFileSync(statsPath, "utf8")) as JsonRecord;
  } catch {
    return {};
  }
})();

const nextStats = {
  ...stats,
  slots_total: slots.length,
  slots_active: slots.filter((slot) => {
    const state = slot["state"];
    return state === "negotiating" || state === "streaming" || state === "closing";
  }).length,
};

const validatedStats = SellerStatsSchema.safeParse(nextStats);
if (!validatedStats.success) {
  process.stderr.write(JSON.stringify({
    error: "seller stats failed validation",
    issues: validatedStats.error.issues,
  }) + "\n");
  process.exit(1);
}

const statsTempPath = `${statsPath}.${process.pid}.${Date.now()}.tmp`;
fs.writeFileSync(statsTempPath, JSON.stringify(validatedStats.data, null, 2));
fs.renameSync(statsTempPath, statsPath);

console.log(JSON.stringify({
  ok: true,
  snippet_id: snippetId,
  slot: validatedSlot.data,
  count: slots.length,
}));
