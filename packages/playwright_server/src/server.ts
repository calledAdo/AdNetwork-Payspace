/**
 * Spawns @playwright/mcp directly — Streamable HTTP on /mcp, legacy SSE on /sse.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

let mcpProc: ChildProcess | null = null;

export interface StartPlaywrightServerResult {
  /** Base URL without trailing slash (e.g. http://127.0.0.1:8931). */
  publicUrl: string;
}

/**
 * Starts @playwright/mcp and waits until /mcp responds.
 */
export async function startPlaywrightServer(): Promise<StartPlaywrightServerResult> {
  if (mcpProc) {
    throw new Error("playwright server already started");
  }

  fs.mkdirSync(config.outputDir, { recursive: true });

  const require = createRequire(import.meta.url);
  const pkgRoot = path.dirname(require.resolve("@playwright/mcp/package.json"));
  const cliPath = path.join(pkgRoot, "cli.js");

  const proc = spawn(
    "node",
    [
      cliPath,
      "--headless",
      "--allowed-hosts",
      "*",
      "--host",
      config.mcpHost,
      "--port",
      String(config.mcpPort),
      "--browser",
      config.browser,
      "--caps",
      "devtools",
      "--isolated",
      "--no-sandbox",
      "--image-responses",
      config.imageResponses,
      "--output-dir",
      config.outputDir,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    },
  );

  mcpProc = proc;
  proc.stdout?.on("data", (chunk: Buffer) => {
    console.log(`[playwright-mcp] ${chunk.toString().trimEnd()}`);
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    console.error(`[playwright-mcp] ${chunk.toString().trimEnd()}`);
  });
  proc.on("exit", (code) => {
    console.log(`[playwright-mcp] exited with code ${code}`);
    mcpProc = null;
  });

  const displayHost = config.mcpHost === "0.0.0.0" ? "127.0.0.1" : config.mcpHost;
  const probeBase = `http://${displayHost}:${config.mcpPort}`;
  await waitForHttp(`${probeBase}/mcp`, 30_000);
  console.log(`[playwright-mcp] ready → ${probeBase}`);

  const publicUrl = probeBase;
  return { publicUrl };
}

/**
 * Sends SIGTERM to the MCP child if running.
 */
export function stopPlaywrightServer(): void {
  if (mcpProc) {
    mcpProc.kill("SIGTERM");
    mcpProc = null;
  }
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.status < 500) return;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Playwright MCP did not become ready at ${url} within ${timeoutMs}ms`);
}
