import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * MCP HTTP bind (same URL agents use as PLAYWRIGHT_MCP_URL base).
 * Port: PLAYWRIGHT_MCP_PORT, else PLAYWRIGHT_SERVER_PORT, else PORT, default 8931.
 * Host: PLAYWRIGHT_MCP_HOST, else PLAYWRIGHT_SERVER_HOST, default 127.0.0.1.
 */
function mcpPort(): number {
  const raw =
    process.env.PLAYWRIGHT_MCP_PORT ??
    process.env.PLAYWRIGHT_SERVER_PORT ??
    process.env.PORT ??
    "8931";
  return Number(raw);
}

function mcpHost(): string {
  return (
    process.env.PLAYWRIGHT_MCP_HOST?.trim() ||
    process.env.PLAYWRIGHT_SERVER_HOST?.trim() ||
    "127.0.0.1"
  );
}

export const config = {
  mcpHost: mcpHost(),
  mcpPort: mcpPort(),
  browser: process.env.PLAYWRIGHT_BROWSER ?? "chromium",
  outputDir:
    process.env.PLAYWRIGHT_OUTPUT_DIR?.trim() || path.join(here, "..", "playwright-output"),
  imageResponses: process.env.PLAYWRIGHT_IMAGE_RESPONSES ?? "omit",
} as const;
