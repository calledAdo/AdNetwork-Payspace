#!/usr/bin/env -S npx tsx
// Create or update one seller slot entry in memory/slots.json using an atomic
// write so readers never observe a partial file.
//
// Usage: npx tsx upsert_slot.mts \
//          --snippet-id snip_abc123 \
//          --patch-json '{"state":"available"}' \
//          [--create-if-missing <true|false>]
//
// Environment:
//   AGENT_DIR path to the seller workspace (required)
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { SellerSlotSchema, SellerSlotsFileSchema } from "./memory_schema.mjs";

type JsonRecord = Record<string, unknown>;

const AGENT_DIR = process.env["AGENT_DIR"];
if (!AGENT_DIR) {
  process.stderr.write(JSON.stringify({ error: "AGENT_DIR environment variable is not set" }) + "\n");
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    "snippet-id": { type: "string" },
    "patch-json": { type: "string" },
    "create-if-missing": { type: "string" },
  },
});

if (!values["snippet-id"] || !values["patch-json"]) {
  process.stderr.write(JSON.stringify({
    error: "--snippet-id and --patch-json are required",
  }) + "\n");
  process.exit(1);
}

const createIfMissing = values["create-if-missing"] !== "false";
const slotsPath = path.join(AGENT_DIR, "memory", "slots.json");

function readSlots(): JsonRecord[] {
  try {
    const raw = fs.readFileSync(slotsPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const validated = SellerSlotsFileSchema.safeParse(parsed);
    if (!validated.success) return [];
    return validated.data as JsonRecord[];
  } catch {
    return [];
  }
}

function writeSlotsAtomic(slots: JsonRecord[]): void {
  const validated = SellerSlotsFileSchema.safeParse(slots);
  if (!validated.success) {
    throw new Error(validated.error.issues.map((issue) => issue.message).join("; "));
  }
  const tempPath = `${slotsPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(validated.data, null, 2));
  fs.renameSync(tempPath, slotsPath);
}

function deepMergeSlot(current: JsonRecord, patch: JsonRecord): JsonRecord {
  const merged: JsonRecord = { ...current, ...patch };
  for (const key of ["slot_details", "publication", "current_booking"] as const) {
    const currentValue = current[key];
    const patchValue = patch[key];
    if (
      currentValue && typeof currentValue === "object" && !Array.isArray(currentValue) &&
      patchValue && typeof patchValue === "object" && !Array.isArray(patchValue)
    ) {
      merged[key] = { ...(currentValue as JsonRecord), ...(patchValue as JsonRecord) };
    }
  }
  if (
    current["correlation_map"] && typeof current["correlation_map"] === "object" && !Array.isArray(current["correlation_map"]) &&
    patch["correlation_map"] && typeof patch["correlation_map"] === "object" && !Array.isArray(patch["correlation_map"])
  ) {
    merged["correlation_map"] = {
      ...(current["correlation_map"] as JsonRecord),
      ...(patch["correlation_map"] as JsonRecord),
    };
  }
  return merged;
}

let patch: JsonRecord;
try {
  const parsed = JSON.parse(values["patch-json"]) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("patch must be a JSON object");
  }
  patch = parsed as JsonRecord;
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: "invalid --patch-json",
    detail: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}

const snippetId = values["snippet-id"];
const slots = readSlots();
const index = slots.findIndex((entry) => entry["snippet_id"] === snippetId);

let updatedSlot: JsonRecord;
if (index === -1) {
  if (!createIfMissing) {
    process.stderr.write(JSON.stringify({
      error: "slot not found",
      snippet_id: snippetId,
    }) + "\n");
    process.exit(1);
  }
  updatedSlot = deepMergeSlot({ snippet_id: snippetId }, patch);
  const validated = SellerSlotSchema.safeParse(updatedSlot);
  if (!validated.success) {
    process.stderr.write(JSON.stringify({
      error: "updated slot failed validation",
      issues: validated.error.issues,
    }) + "\n");
    process.exit(1);
  }
  updatedSlot = validated.data as JsonRecord;
  slots.push(updatedSlot);
} else {
  updatedSlot = deepMergeSlot(slots[index] ?? {}, patch);
  const validated = SellerSlotSchema.safeParse(updatedSlot);
  if (!validated.success) {
    process.stderr.write(JSON.stringify({
      error: "updated slot failed validation",
      issues: validated.error.issues,
    }) + "\n");
    process.exit(1);
  }
  updatedSlot = validated.data as JsonRecord;
  slots[index] = updatedSlot;
}

fs.mkdirSync(path.dirname(slotsPath), { recursive: true });
try {
  writeSlotsAtomic(slots);
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: "slots file failed validation",
    detail: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  slot: updatedSlot,
  count: slots.length,
}));
