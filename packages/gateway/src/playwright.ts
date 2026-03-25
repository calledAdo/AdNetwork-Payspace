// Playwright MCP sidecar — one instance per block, shared by all agents.
//
// Provides browser automation tools (browser_navigate, browser_evaluate,
// browser_network_requests, browser_take_screenshot, etc.) that buyer agents
// call directly to verify ad delivery without a custom backend endpoint.
//
// One Playwright MCP process runs per block gateway. All agents on the block
// share it. Each verification opens an isolated browser context and closes it
// on completion, preventing session bleed between concurrent verifications.
//
// The process is started before app.listen and terminated on SIGTERM
// (after agents have had 2s to finish in-flight work).
//
// Pre-requisites (run once after npm install):
//   npx playwright install chromium
//   npx playwright install-deps chromium

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

let playwrightProc: ChildProcess | null = null;

/**
 * Starts the shared Playwright MCP sidecar unless the operator has pointed the
 * gateway at an externally-managed instance.
 */
export async function startPlaywrightMcp(): Promise<void> {
  // If PLAYWRIGHT_MCP_URL is explicitly set in the environment, the operator
  // is managing an external instance. Don't start a local sidecar.
  if (process.env.PLAYWRIGHT_MCP_URL) {
    console.log(
      `[playwright-mcp] using external instance at ${config.playwrightMcpUrl}`
    );
    return;
  }

  // Ensure screenshot output directory exists
  fs.mkdirSync(config.playwrightOutputDir, { recursive: true });

  // Use the installed package binary rather than npx for deterministic version
  // and fast startup (no network download).
  // createRequire resolves correctly regardless of monorepo hoisting or output dir depth.
  const require = createRequire(import.meta.url);
  const pkgRoot = path.dirname(require.resolve("@playwright/mcp/package.json"));
  const cliPath = path.join(pkgRoot, "cli.js");

  const proc = spawn(
    "node",
    [
      cliPath,
      "--headless",
      "--host",            "127.0.0.1",             // bind to IPv4 loopback explicitly
      "--port",            String(config.playwrightMcpPort),
      "--browser",         config.playwrightBrowser,
      "--caps",            "devtools",               // enables browser_network_requests
      "--isolated",                                  // in-memory profile, no disk state bleed
      "--no-sandbox",                                // required in containers
      "--image-responses", "allow",
      "--output-dir",      config.playwrightOutputDir,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    }
  );

  playwrightProc = proc;

  proc.stdout?.on("data", (chunk: Buffer) => {
    console.log(`[playwright-mcp] ${chunk.toString().trimEnd()}`);
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    console.error(`[playwright-mcp] ${chunk.toString().trimEnd()}`);
  });

  proc.on("exit", (code) => {
    console.log(`[playwright-mcp] exited with code ${code}`);
    playwrightProc = null;
  });

  // Poll the /mcp endpoint — root returns 404, only /mcp and /sse are served
  await waitForHttp(
    `http://127.0.0.1:${config.playwrightMcpPort}/mcp`,
    30_000
  );
  console.log(`[playwright-mcp] ready on port ${config.playwrightMcpPort}`);
}

/**
 * Terminates the shared Playwright MCP sidecar if this process started one.
 */
export function terminatePlaywrightMcp(): void {
  if (playwrightProc) {
    playwrightProc.kill("SIGTERM");
    playwrightProc = null;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Polls an HTTP endpoint until it starts responding or a timeout elapses.
 */
async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      // /mcp returns 200 or 405 depending on method; both mean the server is up
      if (res.status < 500) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Playwright MCP did not become ready at ${url} within ${timeoutMs}ms`
  );
}
