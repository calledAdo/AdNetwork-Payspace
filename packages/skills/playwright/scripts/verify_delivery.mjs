#!/usr/bin/env node
// Verify that a booked ad placement is live and correctly rendered.
//
// Thin client over the platform-managed Playwright MCP server (PLAYWRIGHT_MCP_URL).
// Uses MCP Streamable HTTP (@modelcontextprotocol/sdk) — same transport as
// verify_live_placement.mts. No local browser dependency.
//
// Usage:
//   node verify_delivery.mjs \
//     --page-url      "https://publisher.example/article-1" \
//     --element-id    "snip_abc123" \
//     --dimensions    "728x90" \
//     [--output-dir   "/path/to/evidence"] \
//     [--wait-seconds 8]
//
// Output:
//   JSON with { ok, verified, checks, evidence }
//   Exit 0 = verified. Exit 1 = failed or error (check stderr).
//
// Environment:
//   PLAYWRIGHT_MCP_URL  base URL of the Playwright MCP server
//                       (default: http://localhost:8931)
//   TRACKING_URL        used to derive tracking host for network filtering
import { parseArgs } from "node:util";
import path from "node:path";
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const { values } = parseArgs({
  options: {
    "page-url": { type: "string" },
    "element-id": { type: "string" },
    dimensions: { type: "string" },
    "output-dir": { type: "string" },
    "wait-seconds": { type: "string" },
  },
});

const missing = ["page-url", "element-id", "dimensions"].filter(
  (k) => !values[k],
);
if (missing.length) {
  process.stderr.write(
    JSON.stringify({
      error: `Missing required args: ${missing.map((k) => `--${k}`).join(", ")}`,
    }) + "\n",
  );
  process.exit(1);
}

/** Use IPv4 loopback for MCP URLs — `localhost` may resolve to ::1 and fail host allowlist. */
function normalizePlaywrightMcpBase(raw) {
  const s = String(raw ?? "").replace(/\/+$/, "");
  if (!s) return "http://127.0.0.1:8931";
  try {
    const u = new URL(s);
    if (u.hostname === "localhost") u.hostname = "127.0.0.1";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return s;
  }
}

const MCP_BASE = normalizePlaywrightMcpBase(
  process.env["PLAYWRIGHT_MCP_URL"] ?? "http://127.0.0.1:8931",
);
const pageUrl = String(values["page-url"]);
const elementId = String(values["element-id"]);
const dimsStr = String(values.dimensions);
const outputDir = values["output-dir"] ? String(values["output-dir"]) : null;
const waitSeconds = values["wait-seconds"] ? Number(values["wait-seconds"]) : 8;

const trackingHost = (() => {
  const raw = process.env["TRACKING_URL"];
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
})();

const dimMatch = dimsStr.match(/^(\d+)[xX](\d+)$/);
if (!dimMatch) {
  process.stderr.write(
    JSON.stringify({
      error: `--dimensions must be WIDTHxHEIGHT (e.g. "728x90"), got: "${dimsStr}"`,
    }) + "\n",
  );
  process.exit(1);
}
const expectedW = Number(dimMatch[1]);
const expectedH = Number(dimMatch[2]);

if (outputDir) fs.mkdirSync(outputDir, { recursive: true });

const SELECTORS = [
  `[data-snippet-id="${elementId}"]`,
  `[data-payspace-id="${elementId}"]`,
  `#${elementId}`,
  `[id="${elementId}"]`,
  `[data-placement-id="${elementId}"]`,
  `[src*="${elementId}"]`,
];

function joinText(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      return part.type === "text" && typeof part.text === "string"
        ? part.text
        : "";
    })
    .filter(Boolean)
    .join("\n");
}

async function callTool(client, name, args) {
  return client.request(
    {
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    },
    CallToolResultSchema,
  );
}

const checks = {
  element_found: false,
  element_visible: false,
  dimensions_match: false,
  tracking_fired: trackingHost ? false : null,
};
const evidence = {
  screenshot_path: null,
  element_bbox: null,
  tracking_requests: [],
  selector_used: null,
  page_title: null,
  verified_at: new Date().toISOString(),
};

const client = new Client({
  name: "payspace-verify-delivery",
  version: "1.0.0",
});
const mcpUrl = new URL(`${MCP_BASE}/mcp`);
const transport = new StreamableHTTPClientTransport(mcpUrl);

try {
  await client.connect(transport);

  await callTool(client, "browser_navigate", { url: pageUrl });
  await callTool(client, "browser_wait_for", { time: waitSeconds });

  const snapshotResult = await callTool(client, "browser_snapshot", {});
  const snapshot = joinText(snapshotResult);
  evidence.page_title = snapshot.match(/^# (.+)$/m)?.[1] ?? null;

  for (const selector of SELECTORS) {
    const evaluateResult = await callTool(client, "browser_evaluate", {
      function: `() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return {
          found:   true,
          visible: r.width > 0 && r.height > 0
                   && s.visibility !== "hidden"
                   && s.display    !== "none"
                   && s.opacity    !== "0",
          width:   Math.round(r.width),
          height:  Math.round(r.height),
          x:       Math.round(r.x),
          y:       Math.round(r.y),
        };
      }`,
    });

    const raw = joinText(evaluateResult);
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    if (parsed?.found) {
      checks.element_found = true;
      checks.element_visible = !!parsed.visible;
      evidence.selector_used = selector;
      evidence.element_bbox = {
        x: parsed.x,
        y: parsed.y,
        width: parsed.width,
        height: parsed.height,
      };
      const tol = 0.05;
      checks.dimensions_match =
        Math.abs(parsed.width - expectedW) <= expectedW * tol &&
        Math.abs(parsed.height - expectedH) <= expectedH * tol;
      break;
    }
  }

  if (trackingHost) {
    const netResult = await callTool(client, "browser_network_requests", {
      includeStatic: false,
    });
    const netText = joinText(netResult);
    evidence.tracking_requests = netText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes(trackingHost));
    checks.tracking_fired = evidence.tracking_requests.length > 0;
  }

  if (outputDir) {
    const filename = path.join(outputDir, `ad_${elementId}_${Date.now()}.png`);
    await callTool(client, "browser_take_screenshot", {
      type: "png",
      filename,
    });
    evidence.screenshot_path = filename;
  }

  const verified =
    checks.element_found && checks.element_visible && checks.dimensions_match;

  console.log(JSON.stringify({ ok: true, verified, checks, evidence }));
  process.exit(verified ? 0 : 1);
} catch (err) {
  process.stderr.write(
    JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
      checks,
      evidence,
    }) + "\n",
  );
  process.exit(1);
} finally {
  await transport.close().catch(() => undefined);
}
