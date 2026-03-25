import { getRegistry } from "./registry.js";
import { config } from "./config.js";
import app from "./app.js";
import { recoverOrphanedAgents } from "./spawner.js";
import { startPlaywrightMcp, terminatePlaywrightMcp } from "./playwright.js";
import { startScreenshotMaintenance } from "./maintenance.js";
import type { Server } from "node:http";

// Initialise the in-memory routing table.
getRegistry();

// Re-attach to any OpenClaw processes that survived a gateway restart.
await recoverOrphanedAgents();

// Start Playwright MCP sidecar (shared browser automation for all agents on this block).
await startPlaywrightMcp();

// Schedule screenshot cleanup (30-day retention, runs at startup + every 24h).
startScreenshotMaintenance();

const server: Server = app.listen(config.port, () => {
  console.log(`[gateway] listening  → http://localhost:${config.port}`);
  console.log(`[gateway] block url  → ${config.blockPublicUrl}`);
  console.log(`[gateway] agents dir → ${config.agentsDir}`);
  console.log(
    `[gateway] openclaw   → ${
      config.openclawProfile
        ? `profile:${config.openclawProfile}`
        : "state-dir-override"
    }`
  );
  console.log(`[gateway] state dir  → ${config.openclawStateDir}`);
  console.log(`[gateway] config     → ${config.openclawConfigPath}`);
  console.log(`[gateway] templates  → ${config.agentTemplatesDir}`);
});

/**
 * Gracefully shuts the gateway down after allowing in-flight work to drain.
 */
function handleSigterm(): void {
  console.log("[gateway] SIGTERM received — shutting down");

  server.close();

  // Log registered agents on shutdown (agents are managed by the system openclaw gateway)
  for (const entry of getRegistry().list()) {
    console.log(`[gateway] deregistering ${entry.agentId}`);
  }

  // Give in-flight requests 2s to drain, then tear down Playwright sidecar
  setTimeout(() => terminatePlaywrightMcp(), 2_000);

  // Force exit after 10s total
  setTimeout(() => {
    console.log("[gateway] force exit");
    process.exit(0);
  }, 10_000).unref();
}

/**
 * Normalizes interactive Ctrl+C shutdown into the same SIGTERM flow used by
 * containers and process supervisors.
 */
function handleSigint(): void {
  process.kill(process.pid, "SIGTERM");
}

// Graceful shutdown — SIGTERM from container orchestrator or process manager
process.on("SIGTERM", handleSigterm);
process.on("SIGINT", handleSigint);
