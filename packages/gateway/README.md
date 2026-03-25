# Gateway Package

This package runs the Ad Network gateway for a block. It has three main jobs:

1. Serve public A2A endpoints for spawned agents.
2. Manage agent lifecycle operations such as spawn, inspect, stream, and terminate.
3. Coordinate shared block-level services such as Playwright MCP and screenshot retention.

## Main Runtime Files

- `src/index.ts`
  Boots the gateway, restores agents from disk, starts maintenance jobs, and wires shutdown behavior.
- `src/app.ts`
  Builds the Express application and mounts the route groups.
- `src/config.ts`
  Centralizes environment-backed configuration and path resolution.
- `src/spawner.ts`
  Creates agent workspaces from templates, generates keys, writes memory files, and registers agents with OpenClaw.
- `src/registry.ts`
  Stores the in-memory routing table used by all route handlers.
- `src/routes/a2a.ts`
  Exposes public A2A discovery, card, message proxy, and health routes.
- `src/routes/agents.ts`
  Exposes operator and platform management routes for spawning, inspecting, chatting with, streaming, and deleting agents.
- `src/playwright.ts`
  Starts and stops the shared Playwright MCP sidecar used for browser verification flows.
- `src/maintenance.ts`
  Runs scheduled cleanup for Playwright screenshot artifacts.

## Operational Scripts

- `scripts/run_gateway_local.mjs`
  Launches the built gateway with local OpenClaw state defaults.
- `scripts/openclaw_local.mjs`
  Wraps the OpenClaw CLI so it uses the gateway-local state directory.
- `scripts/local_openclaw_state.mjs`
  Creates the local auth profile store used by the gateway sandbox.
- `scripts/sync_agent_templates.mjs`
  Copies non-code template assets into `dist` during builds.
- `scripts/test_spawn_and_a2a.ts`
  End-to-end smoke test for spawn plus A2A message delivery.
- `scripts/test_playwright_isolation.ts`
  Smoke test for the shared Playwright MCP sidecar.

## Agent Templates

`src/agent_templates/` contains the buyer, seller, and test-agent workspace templates copied by the spawner. These templates include:

- profile files such as `SOUL.md`, `IDENTITY.md`, `MEMORY.md`, and `AGENT_CARD.json`
- bootstrap scripts such as `gen_keypair.mts`
- skill-specific scripts used by buyer and seller agents

Most template scripts are command-style entrypoints, so they are documented with file headers and usage notes rather than large internal helper APIs.
