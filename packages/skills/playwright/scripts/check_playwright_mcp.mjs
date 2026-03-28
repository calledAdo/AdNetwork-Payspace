#!/usr/bin/env node
// Confirm the Playwright MCP server is reachable and exposes required tools.
//
// Usage:
//   node check_playwright_mcp.mjs [--retries 5] [--interval 2000]
//
// Environment:
//   PLAYWRIGHT_MCP_URL  (default: http://localhost:8931)

import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const { values } = parseArgs({
  options: {
    retries: { type: "string" },
    interval: { type: "string" },
  },
});

function normalizePlaywrightMcpBase(raw) {
  const s = String(raw ?? "").replace(/\/+$/, "");
  if (!s) return "http://127.0.0.1:8931";
  try {
    const u = new URL(s);
    if (u.hostname === "localhost") u.hostname = "127.0.0.1";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return s;
  }
}

const MCP_BASE = normalizePlaywrightMcpBase(
  process.env["PLAYWRIGHT_MCP_URL"] ?? "http://127.0.0.1:8931",
);
const retries = values.retries ? Number(values.retries) : 5;
const interval = values.interval ? Number(values.interval) : 2000;

const REQUIRED = [
  "browser_navigate",
  "browser_wait_for",
  "browser_snapshot",
  "browser_evaluate",
  "browser_network_requests",
  "browser_take_screenshot",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probeOnce() {
  const client = new Client({ name: "payspace-playwright-check", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_BASE}/mcp`));
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const tools = (listed.tools ?? []).map((t) => t.name);
    const missing = REQUIRED.filter((t) => !tools.includes(t));
    if (missing.length) {
      throw new Error(`Required tools missing from MCP server: ${missing.join(", ")}`);
    }
    return tools;
  } finally {
    await transport.close().catch(() => undefined);
  }
}

let lastErr;
for (let attempt = 1; attempt <= retries; attempt++) {
  try {
    const tools = await probeOnce();
    console.log(JSON.stringify({ ok: true, url: MCP_BASE, tools_available: tools }));
    process.exit(0);
  } catch (err) {
    lastErr = err;
    if (attempt < retries) {
      process.stderr.write(
        JSON.stringify({
          attempt,
          retrying_in_ms: interval,
          error: err instanceof Error ? err.message : String(err),
        }) + "\n",
      );
      await sleep(interval);
    }
  }
}

process.stderr.write(
  JSON.stringify({
    error: "Playwright MCP server not reachable after all retries",
    url: MCP_BASE,
    detail: lastErr instanceof Error ? lastErr.message : String(lastErr),
  }) + "\n",
);
process.exit(1);
