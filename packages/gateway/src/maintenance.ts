import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

// Retention period — delete screenshots older than this.
const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000; // 30 days

// ── Screenshot cleanup ────────────────────────────────────────────────────────
// Scans PLAYWRIGHT_OUTPUT_DIR and deletes files older than RETENTION_MS.
// Runs once at startup, then every 24 hours.

/**
 * Deletes old Playwright screenshots so evidence storage does not grow
 * without bounds on long-running gateway deployments.
 */
function runScreenshotCleanup(): void {
  const dir = config.playwrightOutputDir;
  if (!fs.existsSync(dir)) return;

  const cutoff = Date.now() - RETENTION_MS;
  let deleted = 0;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(dir, entry.name);
      try {
        const { mtimeMs } = fs.statSync(filePath);
        if (mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      } catch {
        // file may have been removed concurrently — skip
      }
    }
  } catch (err) {
    console.error("[maintenance] screenshot cleanup error:", err);
    return;
  }

  if (deleted > 0) {
    console.log(`[maintenance] deleted ${deleted} screenshot(s) older than 30 days`);
  }
}

/**
 * Starts the recurring screenshot retention job and executes one cleanup pass
 * immediately so stale files are handled even after downtime.
 */
export function startScreenshotMaintenance(): void {
  // Run immediately on startup, then every 24 hours.
  runScreenshotCleanup();
  setInterval(runScreenshotCleanup, 24 * 60 * 60 * 1_000);
  console.log("[maintenance] screenshot cleanup scheduled (30-day retention, 24h interval)");
}
