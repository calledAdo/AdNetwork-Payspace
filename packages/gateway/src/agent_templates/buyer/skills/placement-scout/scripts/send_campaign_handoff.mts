#!/usr/bin/env -S npx tsx
// Send tracked campaign creative to the seller after price agreement and
// extract any returned task id from the seller response.
//
// Usage: npx tsx send_campaign_handoff.mts \
//          --seller-a2a-url <https://...> \
//          --context-id <ctx-...> \
//          --agreed-price <udt_per_mille> \
//          --tracked-image-url <https://...> \
//          --tracked-click-url <https://...> \
//          --write-up "..."
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

type JsonRecord = Record<string, unknown>;

const { values } = parseArgs({
  options: {
    "seller-a2a-url": { type: "string" },
    "context-id": { type: "string" },
    "agreed-price": { type: "string" },
    "tracked-image-url": { type: "string" },
    "tracked-click-url": { type: "string" },
    "write-up": { type: "string" },
    "request-id": { type: "string" },
    "message-id": { type: "string" },
  },
});

const required = [
  "seller-a2a-url",
  "context-id",
  "agreed-price",
  "tracked-image-url",
  "tracked-click-url",
  "write-up",
] as const;

for (const key of required) {
  if (!values[key]) {
    process.stderr.write(JSON.stringify({ error: `--${key} is required` }) + "\n");
    process.exit(1);
  }
}

const sellerA2aUrl = values["seller-a2a-url"]!;

function parseJsonString(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function visitCandidates(value: unknown, out: JsonRecord[], seen: Set<unknown>): void {
  if (!value || seen.has(value)) return;
  if (typeof value === "string") {
    const parsed = parseJsonString(value);
    if (parsed !== value) visitCandidates(parsed, out, seen);
    return;
  }
  if (typeof value !== "object") return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) visitCandidates(item, out, seen);
    return;
  }
  const record = value as JsonRecord;
  out.push(record);
  for (const nested of Object.values(record)) visitCandidates(nested, out, seen);
}

function collectCandidates(value: unknown): JsonRecord[] {
  const out: JsonRecord[] = [];
  visitCandidates(value, out, new Set());
  return out;
}

function extractTaskId(candidates: JsonRecord[]): string | null {
  for (const candidate of candidates) {
    const task = candidate["task"];
    if (task && typeof task === "object" && !Array.isArray(task)) {
      const taskId = (task as JsonRecord)["id"];
      if (typeof taskId === "string" && taskId.trim()) return taskId;
    }
    if (
      typeof candidate["id"] === "string" &&
      candidate["status"] &&
      typeof candidate["status"] === "object"
    ) {
      return candidate["id"] as string;
    }
  }
  return null;
}

const body = {
  jsonrpc: "2.0",
  id: values["request-id"] ?? `req-${randomUUID()}`,
  method: "message/send",
  params: {
    message: {
      messageId: values["message-id"] ?? randomUUID(),
      contextId: values["context-id"],
      role: "user",
      parts: [{
        data: {
          skill: "receive-campaign",
          agreed_price_per_mille: values["agreed-price"],
          tracked_image_url: values["tracked-image-url"],
          tracked_click_url: values["tracked-click-url"],
          write_up: values["write-up"],
        },
        mediaType: "application/json",
      }],
    },
  },
};

let responseData: unknown;
let responseStatus = 0;
try {
  const response = await fetch(sellerA2aUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  responseStatus = response.status;
  responseData = await response.json();
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: "failed to send campaign handoff",
    detail: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}

if (responseStatus >= 400) {
  process.stderr.write(JSON.stringify({
    error: "campaign handoff failed",
    status: responseStatus,
    response: responseData,
  }) + "\n");
  process.exit(1);
}

const candidates = collectCandidates(responseData);
const taskId = extractTaskId(candidates);
const contextId =
  candidates.find((candidate) => typeof candidate["contextId"] === "string")?.["contextId"] ??
  values["context-id"];

console.log(JSON.stringify({
  ok: true,
  task_id: taskId,
  context_id: contextId,
  request: body,
  response: responseData,
}));
