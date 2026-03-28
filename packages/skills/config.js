export const skillsConfig = {
  // Identity and signing
  agentDir: process.env.AGENT_DIR ?? "",
  privateKey: process.env.PRIVATE_KEY ?? "",

  // Chain-facing endpoint
  payspaceMcpUrl: process.env.PAYSPACE_MCP_URL ?? "http://localhost:3000",

  // Tracking / metrics endpoint
  trackingUrl: process.env.TRACKING_URL ?? "http://localhost:4000",

  // Browser verification
  playwrightMcpUrl: process.env.PLAYWRIGHT_MCP_URL ?? "http://127.0.0.1:8931",

  // Asset defaults
  defaultXudtTypeArgs: process.env.DEFAULT_XUDT_TYPE_ARGS ?? "",
};

// no shared runtime assertion helper needed currently
