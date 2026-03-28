#!/usr/bin/env node
// Ensure the buyer workspace has the memory files and directories the runtime
// expects before discovery, negotiation, and reporting begin.
//
// Usage: node ensure_memory_state_buyer.mjs
// Output: JSON summary of created and existing paths
//
// Environment:
//   AGENT_DIR path to the agent workspace (required)
import fs from "node:fs";
import path from "node:path";
import { BuyerPlacementsFileSchema, BuyerStatsSchema } from "./memory_schema_buyer.mjs";
import { skillsConfig } from "../../config.js";

const AGENT_DIR = skillsConfig.agentDir;
if (!AGENT_DIR) {
  process.stderr.write(JSON.stringify({ error: "AGENT_DIR environment variable is not set" }) + "\n");
  process.exit(1);
}

const memoryDir = path.join(AGENT_DIR, "memory");
const requiredDirs = [
  memoryDir,
  path.join(memoryDir, "conversations"),
  path.join(memoryDir, "reports"),
  path.join(memoryDir, "reports", "daily"),
  path.join(memoryDir, "reports", "placements"),
  path.join(memoryDir, "tickets"),
];

const placementsPath = path.join(memoryDir, "placements.json");
const statsPath = path.join(memoryDir, "stats.json");
const suspiciousMessagesPath = path.join(memoryDir, "suspicious_messages.jsonl");

function writeJsonAtomic(filePath, value) {
  const validated =
    filePath.endsWith("placements.json")
      ? BuyerPlacementsFileSchema.safeParse(value)
      : BuyerStatsSchema.safeParse(value);
  if (!validated.success) {
    throw new Error(validated.error.issues.map((issue) => issue.message).join("; "));
  }
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(validated.data, null, 2));
  fs.renameSync(tempPath, filePath);
}

const created = [];
const existing = [];

for (const dirPath of requiredDirs) {
  if (fs.existsSync(dirPath)) {
    existing.push(dirPath);
    continue;
  }
  fs.mkdirSync(dirPath, { recursive: true });
  created.push(dirPath);
}

if (!fs.existsSync(placementsPath)) {
  writeJsonAtomic(placementsPath, []);
  created.push(placementsPath);
} else {
  existing.push(placementsPath);
}

if (!fs.existsSync(statsPath)) {
  const initialStats = {
    last_report_date: null,
    total_spend_udt: "0",
    total_impressions: 0,
    active_placement_count: 0,
  };
  writeJsonAtomic(statsPath, initialStats);
  created.push(statsPath);
} else {
  existing.push(statsPath);
}

if (!fs.existsSync(suspiciousMessagesPath)) {
  fs.writeFileSync(suspiciousMessagesPath, "");
  created.push(suspiciousMessagesPath);
} else {
  existing.push(suspiciousMessagesPath);
}

console.log(JSON.stringify({
  ok: true,
  agent_dir: AGENT_DIR,
  memory_dir: memoryDir,
  created,
  existing,
}));
