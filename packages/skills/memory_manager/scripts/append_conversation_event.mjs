#!/usr/bin/env node
// Append a conversation event to memory/conversations/{contextId}.json using
// an atomic write so concurrent readers never observe a partial file.
//
// Usage: node append_conversation_event.mjs \
//          --context-id <ctx-...> \
//          --message-json '{"direction":"outbound","body":{...}}' \
//          [--status negotiating] \
//          [--summary "optional summary"] \
//          [--create-if-missing <true|false>]
//
// Environment:
//   AGENT_DIR path to the agent workspace (required)
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { ConversationLogSchema } from "./memory_schema_buyer.mjs";
import { skillsConfig } from "../../config.js";

const AGENT_DIR = skillsConfig.agentDir;
if (!AGENT_DIR) {
  process.stderr.write(JSON.stringify({ error: "AGENT_DIR environment variable is not set" }) + "\n");
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    "context-id": { type: "string" },
    "message-json": { type: "string" },
    status: { type: "string" },
    summary: { type: "string" },
    "create-if-missing": { type: "string" },
  },
});

if (!values["context-id"] || !values["message-json"]) {
  process.stderr.write(JSON.stringify({
    error: "--context-id and --message-json are required",
  }) + "\n");
  process.exit(1);
}

const createIfMissing = values["create-if-missing"] !== "false";
const contextId = values["context-id"];
const conversationsDir = path.join(AGENT_DIR, "memory", "conversations");
const conversationPath = path.join(conversationsDir, `${contextId}.json`);

function nowIso() {
  return new Date().toISOString();
}

function writeJsonAtomic(filePath, value) {
  const validated = ConversationLogSchema.safeParse(value);
  if (!validated.success) {
    throw new Error(validated.error.issues.map((issue) => issue.message).join("; "));
  }
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(validated.data, null, 2));
  fs.renameSync(tempPath, filePath);
}

function parseMessageJson(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("message must be a JSON object");
  }
  return parsed;
}

function readConversation(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const validated = ConversationLogSchema.safeParse(parsed);
    if (!validated.success) return null;
    return validated.data;
  } catch {
    return null;
  }
}

let message;
try {
  message = parseMessageJson(values["message-json"]);
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: "invalid --message-json",
    detail: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}

fs.mkdirSync(conversationsDir, { recursive: true });

const current = readConversation(conversationPath);
if (!current && !createIfMissing) {
  process.stderr.write(JSON.stringify({
    error: "conversation does not exist",
    context_id: contextId,
  }) + "\n");
  process.exit(1);
}

const messages = Array.isArray(current?.["messages"]) ? [...current["messages"]] : [];
const stampedMessage = {
  ...message,
  at: message["at"] ?? nowIso(),
};
messages.push(stampedMessage);

const nextConversation = {
  contextId,
  startedAt: current?.["startedAt"] ?? nowIso(),
  endedAt: current?.["endedAt"] ?? null,
  status: values.status ?? current?.["status"] ?? "open",
  messages,
  updatedAt: nowIso(),
};

if (values.summary) {
  nextConversation["summary"] = values.summary;
} else if (current?.["summary"] !== undefined) {
  nextConversation["summary"] = current["summary"];
}

try {
  writeJsonAtomic(conversationPath, nextConversation);
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: "conversation failed validation",
    detail: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  context_id: contextId,
  message_count: messages.length,
  path: conversationPath,
}));
