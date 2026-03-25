#!/usr/bin/env node

import { spawn } from "node:child_process";
import { configPath, ensureLocalMainAuthStore, stateDir } from "./local_openclaw_state.mjs";

const openclawBin = process.env.OPENCLAW_BIN || "openclaw";

ensureLocalMainAuthStore(process.env);

const child = spawn(openclawBin, process.argv.slice(2), {
  stdio: "inherit",
  env: {
    ...process.env,
    OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR || stateDir,
    OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH || configPath,
  },
});

/**
 * Mirrors the child OpenClaw process exit status back to this wrapper script.
 */
function handleChildExit(code, signal) {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
}

child.on("exit", handleChildExit);
