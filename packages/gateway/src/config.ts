import fs from "node:fs";
import path from "node:path";

/**
 * Resolves the agent template directory the gateway should copy from.
 * The build output is preferred so spawned agents can run compiled `.mjs`
 * scripts, but local source is used as a fallback during development.
 */
function resolveAgentTemplatesDir(): string {
  const candidates = [
    new URL("./agent_templates", import.meta.url).pathname,
    new URL("../src/agent_templates", import.meta.url).pathname,
  ];

  const existing = candidates.find((candidate) =>
    fs.existsSync(candidate) && fs.existsSync(path.join(candidate, "buyer", "AGENT_CARD.json"))
  );
  return existing ?? candidates[0]!;
}

// Configuration — read from environment variables.
// Express sets AGENT_DIR per-process for each spawned agent;
// these are block-level settings for the gateway itself.

/**
 * Centralized gateway configuration resolved once at startup.
 * Keeping env parsing here lets the rest of the codebase depend on concrete,
 * already-normalized values such as numbers, URLs, and absolute paths.
 */
export const config = {
  // Single public-facing port — all traffic (A2A + spawn management) goes here.
  // TLS is terminated upstream (nginx/caddy) before hitting this port.
  port: Number(process.env.PORT ?? 8080),

  // Root directory where agent working directories are created.
  // Each spawned agent gets: {agentsDir}/{agentId}/
  agentsDir:
    process.env.AGENTS_DIR?.trim() || new URL("../agent-workspaces", import.meta.url).pathname,

  // Path to the runtime-ready agent templates.
  // Prefer dist/ so spawned workspaces get compiled .mjs scripts.
  agentTemplatesDir: resolveAgentTemplatesDir(),

  // Dedicated OpenClaw state/config for this gateway instance.
  // The repo gateway should not need to share the user's personal ~/.openclaw.
  openclawStateDir:
    process.env.OPENCLAW_STATE_DIR?.trim() || new URL("../.openclaw", import.meta.url).pathname,
  openclawConfigPath:
    process.env.OPENCLAW_CONFIG_PATH?.trim() ||
    new URL("../.openclaw/openclaw.json", import.meta.url).pathname,

  // Public URL of this block gateway (no trailing slash).
  // Used to construct the a2aUrl for each agent:
  //   {blockPublicUrl}/a2a/{agentId}
  blockPublicUrl:
    process.env.BLOCK_PUBLIC_URL ??
    "http://localhost:8080",

  // System OpenClaw gateway URL — all agent HTTP calls go here.
  // One gateway serves all agents on this block; agents are routed via
  // x-openclaw-agent-id header.
  openclawGatewayUrl: process.env.OPENCLAW_GATEWAY_URL ?? "http://localhost:18789",

  // Bearer token for the system OpenClaw gateway.
  openclawGatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN ?? "",

  // Shared MCP server URL — injected into each agent's environment.
  mcpUrl: process.env.MCP_URL ?? "http://localhost:3000",

  // Tracking service base URL (impression pixel, click redirect, stats, verify).
  // Payspace users: https://track.payspace.io
  // External deployments: point to own tracking infrastructure or leave empty.
  trackingUrl: process.env.TRACKING_URL ?? "",

  // Payspace API base URL (placement details registry).
  // Payspace users: https://api.payspace.io
  // External deployments: point to own details service or leave empty.
  payspaceApiUrl: process.env.PAYSPACE_API_URL ?? "",

  // Path to the openclaw CLI binary (used for `agents add` and `agents delete`).
  openclawBin: process.env.OPENCLAW_BIN ?? "openclaw",

  // Optional dedicated OpenClaw profile for this gateway.
  // When set, the gateway will call:
  //   openclaw --profile <name> agents add/delete ...
  // This keeps spawned marketplace agents out of the user's default
  // ~/.openclaw profile and lets the gateway own its own config/state tree
  // such as ~/.openclaw-<name>/openclaw.json.
  openclawProfile: process.env.OPENCLAW_PROFILE?.trim() || "",

  // Browser to use for Playwright — chromium, firefox, or webkit.
  playwrightBrowser: process.env.PLAYWRIGHT_BROWSER ?? "chromium",

  // Playwright MCP sidecar — one instance per block, shared by all agents.
  // Provides browser_navigate, browser_evaluate, browser_network_requests, etc.
  // Set PLAYWRIGHT_MCP_PORT to change the port; PLAYWRIGHT_MCP_URL to point
  // agents at an external instance (e.g. if running Playwright on a separate host).
  playwrightMcpPort: Number(process.env.PLAYWRIGHT_MCP_PORT ?? 9000),
  playwrightMcpUrl: process.env.PLAYWRIGHT_MCP_URL ?? "http://localhost:9000",

  // Directory where Playwright MCP writes screenshot files.
  // Agents save evidence keyed by placement_id:timestamp.
  playwrightOutputDir:
    process.env.PLAYWRIGHT_OUTPUT_DIR ?? "/var/lib/payspace/screenshots",

  // Shared node_modules path for agent bash scripts.
  // All agents on the block reference this directory via NODE_PATH so they
  // don't need their own npm install. Install blake2b and @noble/curves here once.
  sharedNodeModulesPath:
    process.env.SHARED_NODE_MODULES_PATH ?? new URL("../node_modules", import.meta.url).pathname,

  // Bearer token the PaySpace backend must supply in Authorization header
  // when calling spawn/management routes.
  // Required in production — if unset, spawn routes reject all requests.
  payspaceApiKey: process.env.PAYSPACE_API_KEY ?? "",
} as const;
