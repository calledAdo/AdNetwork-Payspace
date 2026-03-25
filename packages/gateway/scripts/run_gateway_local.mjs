#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { configPath, ensureLocalMainAuthStore, gatewayRoot, stateDir, workspacesDir } from "./local_openclaw_state.mjs";
const entrypoint = path.join(gatewayRoot, "dist", "index.js");

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const port = Number(config.gateway?.port ?? 18789);
const token = String(config.gateway?.auth?.token ?? "");

ensureLocalMainAuthStore(process.env);

const child = spawn(process.execPath, [entrypoint], {
  stdio: "inherit",
  cwd: gatewayRoot,
  env: {
    ...process.env,
    OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR || stateDir,
    OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH || configPath,
    AGENTS_DIR: process.env.AGENTS_DIR || workspacesDir,
    OPENCLAW_GATEWAY_URL: process.env.OPENCLAW_GATEWAY_URL || `http://127.0.0.1:${port}`,
    OPENCLAW_GATEWAY_TOKEN: process.env.OPENCLAW_GATEWAY_TOKEN || token,
  },
});

/**
 * Mirrors the gateway child process exit status back to this launcher script.
 */
function handleChildExit(code, signal) {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
}

child.on("exit", handleChildExit);
