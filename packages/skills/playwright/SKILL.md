---
name: playwright
description: Browser-based live delivery verification for booked ad placements.
---

# Skill: playwright

This skill verifies that a booked ad placement is actually live in the
publisher's browser before the buyer opens a payment channel.

It is the gate between the `verifying` heartbeat state and `channel_open`.
The buyer must not open a payment channel until this skill confirms delivery.

## Possible Tasks

- start and health-check the Playwright MCP server
- verify that a booked ad element is present, visible, correctly sized, and
  firing tracking requests in a real browser session

## Scripts

- `scripts/start_playwright_mcp.mjs`
  Writes a config file to `$AGENT_DIR/memory/playwright_mcp_config.json` and
  spawns `@playwright/mcp` over HTTP on `PLAYWRIGHT_MCP_PORT` (default 8931).
  Passes `--allowed-hosts *` so Streamable HTTP MCP clients can connect without
  host-check failures. Prefer `PLAYWRIGHT_MCP_URL=http://127.0.0.1:<port>` from
  clients (avoids `localhost` resolving to IPv6 `::1` in some environments).
  Stays running as a long-lived process. Writes `{ ok, url }` to stdout when
  the server is ready.

- `scripts/check_playwright_mcp.mjs`
  Health-check: connects via MCP Streamable HTTP, lists tools, confirms all tools
  required by `verify_delivery.mjs` are present. Retries with backoff.
  Run this at buyer startup before any verification attempt.

- `scripts/verify_delivery.mjs`
  Thin MCP client using `@modelcontextprotocol/sdk` (Streamable HTTP) to the
  running server. Calls tools to navigate to the publisher page, locate the ad
  element, check visibility and rendered dimensions, detect tracking requests,
  and capture a screenshot. Returns structured JSON evidence. Exit 0 = verified,
  exit 1 = failed.

## How The Scripts Work Together

```
[buyer startup]
  start_playwright_mcp  →  MCP server running at PLAYWRIGHT_MCP_URL
  check_playwright_mcp  →  confirms tools/list responds

[heartbeat: verifying state]
  verify_delivery       →  calls MCP tools over HTTP
                        →  { verified: true }  →  build_open_channel
                        →  { verified: false } →  increment failures, warn seller
```

## Inputs to verify_delivery.mjs

| Arg | Source in buyer memory | Notes |
|-----|------------------------|-------|
| `--page-url` | `delivery.live_url` → fallback `slot_details.page_url` | Actual publisher page |
| `--element-id` | `delivery.element_id` → fallback `slot_details.snippet_id` | DOM anchor |
| `--dimensions` | `slot_details.dimensions` | e.g. `"728x90"` |
| `--output-dir` | `$AGENT_DIR/memory/evidence/{context_id}` | Screenshots saved here |

Tracking detection is handled internally: the script reads `TRACKING_URL` from
the environment and filters network requests for that host's origin.

## Output shape (verify_delivery.mjs)

```json
{
  "ok": true,
  "verified": true,
  "checks": {
    "element_found": true,
    "element_visible": true,
    "dimensions_match": true,
    "tracking_fired": true
  },
  "evidence": {
    "screenshot_path": "/path/to/ad_snip_abc123_1712000000.png",
    "element_bbox": { "x": 120, "y": 340, "width": 728, "height": 90 },
    "tracking_requests": ["https://tracking.payspace.io/tracking/image?id=snip_abc123"],
    "selector_used": "[data-snippet-id=\"snip_abc123\"]",
    "page_title": "Example Publisher Article",
    "verified_at": "2026-03-24T10:00:00.000Z"
  }
}
```

Exit 0 = `verified: true`. Exit 1 = failed or error (check stderr).

## Verification Logic

**Element discovery** — tries selectors in priority order:

1. `[data-snippet-id="{id}"]`
2. `[data-payspace-id="{id}"]`
3. `#{id}`
4. `[id="{id}"]`
5. `[data-placement-id="{id}"]`
6. `[src*="{id}"]`

**Dimensions** — rendered bounding box via `browser_evaluate` compared to
`WIDTHxHEIGHT` with ±5% tolerance for borders and sub-pixel rounding.

**Tracking** — filters `browser_network_requests` output for any URL whose
origin matches `TRACKING_URL`. A false here does not block `verified` — the
backend activates snippets asynchronously on first real impression.

## Dependency

Scripts use **Node 18+** built-ins plus **`@modelcontextprotocol/sdk`** (declared
in `packages/skills/package.json`) for MCP Streamable HTTP to `@playwright/mcp`.

The browser is provided by `@playwright/mcp`, installed where the server runs:

```bash
npm install -g @playwright/mcp
npx playwright install chromium
```

## Evidence Persistence

Save `verify_delivery.mjs` output JSON to:

```
$AGENT_DIR/memory/evidence/{context_id}/verify_{timestamp}.json
```

The screenshot at `evidence.screenshot_path` plus this JSON form the dispute
audit trail. Keep both for the life of the placement.

## Notes

- `start_playwright_mcp.mjs` must be running before `verify_delivery.mjs` is called.
- Always run `check_playwright_mcp.mjs` at buyer startup — before the first
  heartbeat cycle reaches `verifying` state.
- `tracking_fired: false` at verification time is informational only. Do not
  block channel opening on tracking alone.
- For iframes, the script finds the iframe element itself (sufficient for
  dimension and visibility checks).
