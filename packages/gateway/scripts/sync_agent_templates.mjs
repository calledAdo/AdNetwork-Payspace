#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const gatewayRoot = path.resolve(here, "..");
const srcRoot = path.join(gatewayRoot, "src", "agent_templates");
const distRoot = path.join(gatewayRoot, "dist", "agent_templates");

/**
 * Filters out source-only and environment-specific files that should not be
 * copied into the runtime-ready template bundle.
 */
function shouldCopy(fileName) {
  if (fileName === "auth-profiles.json") return false;
  if (fileName.endsWith(".mts")) return false;
  if (fileName.endsWith(".ts")) return false;
  if (fileName.endsWith(".d.mts")) return false;
  if (fileName.endsWith(".map")) return false;
  return true;
}

/**
 * Recursively copies non-code template assets from `src` into `dist` so the
 * built gateway can materialize fully-populated agent workspaces.
 */
function syncDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      syncDir(srcPath, destPath);
      continue;
    }

    if (!shouldCopy(entry.name)) continue;
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  }
}

if (!fs.existsSync(srcRoot)) {
  console.error(`[sync-agent-templates] source path missing: ${srcRoot}`);
  process.exit(1);
}

syncDir(srcRoot, distRoot);
console.log(`[sync-agent-templates] synced assets from ${srcRoot} -> ${distRoot}`);
