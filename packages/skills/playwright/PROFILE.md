# Profile: playwright

## Scope

`playwright` is the buyer agent's live delivery verification capability.
It manages the Playwright MCP server lifecycle and provides a deterministic
verification script that the buyer runs before opening any payment channel.

Scope is intentionally narrow:

- spawn and health-check `@playwright/mcp` server
- navigate to a live publisher URL
- locate the ad element by its `snippet_id` / `element_id` DOM anchor
- assert element visibility and rendered dimensions
- detect tracking pixel network requests
- capture screenshot evidence

It does not perform exploratory browsing, submit forms, or take any action
that could interfere with the publisher's page.

## Type

`capability` — buyer-local verification tool. Not required on the counterparty.

## Dependencies

### Skills

None.

### NPM Packages

`verify_delivery.mjs` and `check_playwright_mcp.mjs` use **`@modelcontextprotocol/sdk`**
(from `packages/skills/package.json`) for MCP Streamable HTTP. No direct
`playwright` import in skill scripts.

The platform must have **`@playwright/mcp`** installed where the server runs and Chromium available:

```bash
npm install -g @playwright/mcp
npx playwright install chromium
```

### MCP Servers

- `@playwright/mcp` — started by `start_playwright_mcp.mjs` at buyer startup.
  Runs as a long-lived HTTP process at `PLAYWRIGHT_MCP_PORT` (default 8931).
  The launcher passes `--allowed-hosts *` so MCP Streamable HTTP clients are not
  blocked by DNS rebinding checks when connecting from the same host.
  Tools used by `verify_delivery.mjs`:

  - `browser_navigate`
  - `browser_wait_for`
  - `browser_snapshot`
  - `browser_evaluate`
  - `browser_network_requests`
  - `browser_take_screenshot`

### External Services

- Publisher page URLs — must be reachable from the buyer agent's host.
- `TRACKING_URL` — used to derive the tracking origin for network request
  filtering.

## Compatibility

`playwright` is a local buyer-only capability. Sellers do not need it.

## Assumptions

- Buyer agent host can reach publisher pages over HTTP/S
- `@playwright/mcp` is installed and Chromium is available
- `start_playwright_mcp.mjs` is started before any heartbeat reaches
  `verifying` state
- The seller has installed the snippet before `verify_delivery.mjs` runs

## Environment Variables

| Variable | Used by | Default |
|----------|---------|---------|
| `PLAYWRIGHT_MCP_URL` | `verify_delivery.mjs`, `check_playwright_mcp.mjs` | `http://127.0.0.1:8931` |
| `PLAYWRIGHT_MCP_PORT` | `start_playwright_mcp.mjs` | `8931` |
| `PLAYWRIGHT_MCP_HOST` | `start_playwright_mcp.mjs` | `127.0.0.1` |
| `PLAYWRIGHT_OUTPUT_DIR` | `start_playwright_mcp.mjs` | `$AGENT_DIR/memory/evidence` |
| `TRACKING_URL` | `verify_delivery.mjs` | — (optional; required for tracking check) |
| `AGENT_DIR` | `start_playwright_mcp.mjs` | — (required) |

## Best Practices

- Start `start_playwright_mcp.mjs` as a supervised background process —
  restart it automatically if it exits
- Run `check_playwright_mcp.mjs` at buyer startup and after any suspected
  server restart before trusting `verify_delivery.mjs` results
- Always save evidence (`--output-dir`) — screenshot + JSON are the dispute
  audit trail
- On the `streaming` heartbeat cycle, re-run `verify_delivery.mjs` each
  cycle and skip payment if it fails
- Respect the `verification_failures` threshold before escalating to
  close/dispute — transient failures (CDN cold start, slow page) are expected
