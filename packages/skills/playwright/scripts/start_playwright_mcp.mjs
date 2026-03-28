#!/usr/bin/env node
// Start the Playwright MCP server for the buyer agent.
//
// Writes config to $AGENT_DIR/memory/playwright_mcp_config.json and spawns
// npx @playwright/mcp --config <path> over HTTP so verify_delivery.mjs can call it.
//
// Usage:
//   node start_playwright_mcp.mjs
//
// Environment:
//   PLAYWRIGHT_MCP_PORT   port to bind (default: 8931)
//   PLAYWRIGHT_MCP_HOST   host to bind (default: 127.0.0.1)
//   PLAYWRIGHT_OUTPUT_DIR directory for screenshots and session output
//                         (default: $AGENT_DIR/memory/evidence)
//   AGENT_DIR             buyer agent workspace root (required)
//
// On success, prints one line to stdout:
//   { "ok": true, "url": "http://localhost:8931" }
// (localhost preferred in URL for Playwright MCP host allowlist.)

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const AGENT_DIR = process.env["AGENT_DIR"];
if (!AGENT_DIR) {
  process.stderr.write(JSON.stringify({ error: "AGENT_DIR is required" }) + "\n");
  process.exit(1);
}

const PORT = process.env["PLAYWRIGHT_MCP_PORT"] ?? "8931";
const HOST = process.env["PLAYWRIGHT_MCP_HOST"] ?? "127.0.0.1";
const OUTPUT_DIR =
  process.env["PLAYWRIGHT_OUTPUT_DIR"] ?? path.join(AGENT_DIR, "memory", "evidence");

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const configPath = path.join(AGENT_DIR, "memory", "playwright_mcp_config.json");
const config = {
  browser: {
    browserName: "chromium",
    isolated: true,
    launchOptions: {
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    },
    contextOptions: {
      viewport: { width: 1440, height: 900 },
    },
  },
  server: {
    port: Number(PORT),
    host: HOST,
    allowedHosts: [HOST, "localhost", "127.0.0.1"],
  },
  outputDir: OUTPUT_DIR,
  outputMode: "file",
  imageResponses: "omit",
  snapshot: {
    mode: "incremental",
  },
  capabilities: ["devtools"],
};

const tmp = `${configPath}.${process.pid}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
fs.renameSync(tmp, configPath);

const proc = spawn(
  "npx",
  [
    "-y",
    "@playwright/mcp@latest",
    "--allowed-hosts",
    "*",
    "--config",
    configPath,
  ],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  },
);

proc.stderr?.on("data", (chunk) => {
  process.stderr.write(chunk);
});
proc.stdout?.on("data", (chunk) => {
  process.stderr.write(chunk);
});

function announceUrl() {
  const displayHost = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
  const url = `http://${displayHost}:${PORT}`;
  process.stdout.write(JSON.stringify({ ok: true, url }) + "\n");
}

async function waitForHttp(mcpUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(mcpUrl, { signal: AbortSignal.timeout(1500) });
      if (res.status < 500) {
        announceUrl();
        return;
      }
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Playwright MCP did not become ready at ${mcpUrl} within ${timeoutMs}ms`);
}

proc.on("error", (err) => {
  process.stderr.write(
    JSON.stringify({
      error: "failed to start playwright MCP server",
      detail: err.message,
    }) + "\n",
  );
  process.exit(1);
});

proc.on("exit", (code, signal) => {
  process.stderr.write(
    JSON.stringify({
      event: "playwright_mcp_exited",
      code,
      signal,
    }) + "\n",
  );
  process.exit(code ?? 1);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    proc.kill(sig);
  });
}

const displayHost = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
const readyProbeUrl = `http://${displayHost}:${PORT}/mcp`;

waitForHttp(readyProbeUrl, 60_000).catch((err) => {
  process.stderr.write(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) + "\n");
  proc.kill("SIGTERM");
  process.exit(1);
});
