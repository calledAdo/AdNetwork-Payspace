#!/usr/bin/env -S npx tsx
// Verify that a booked placement is visibly live and wired to buyer tracking
// using the shared Playwright MCP sidecar.
//
// Usage: npx tsx verify_live_placement.mts \
//          --page-url <https://...> \
//          --element-id <snippet-or-dom-id> \
//          [--dimensions <728x90>] \
//          [--booking-id <book_...>] \
//          [--screenshot-file <name.png>]
//
// Environment:
//   PLAYWRIGHT_MCP_URL (default: http://localhost:9000)
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

type JsonRecord = Record<string, unknown>;

const PLAYWRIGHT_MCP_URL = process.env["PLAYWRIGHT_MCP_URL"] ?? "http://localhost:9000";

const { values } = parseArgs({
  options: {
    "page-url": { type: "string" },
    "element-id": { type: "string" },
    dimensions: { type: "string" },
    "booking-id": { type: "string" },
    "screenshot-file": { type: "string" },
  },
});

if (!values["page-url"] || !values["element-id"]) {
  process.stderr.write(JSON.stringify({
    error: "--page-url and --element-id are required",
  }) + "\n");
  process.exit(1);
}

const pageUrl = values["page-url"];
const elementId = values["element-id"];
const bookingId = values["booking-id"] ?? null;
const screenshotFile =
  values["screenshot-file"] ??
  `verify-${elementId.replace(/[^a-zA-Z0-9_-]/g, "_")}-${Date.now()}.png`;

function parseDimensions(raw: string | undefined): {
  expectedWidth: number | null;
  expectedHeight: number | null;
} {
  if (!raw) return { expectedWidth: null, expectedHeight: null };
  const match = raw.trim().match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return { expectedWidth: null, expectedHeight: null };
  return {
    expectedWidth: Number(match[1]),
    expectedHeight: Number(match[2]),
  };
}

function joinText(result: { content?: unknown[] }): string {
  return Array.isArray(result.content)
    ? result.content
        .map((part) => {
          if (!part || typeof part !== "object") return "";
          const typed = part as JsonRecord;
          return typed["type"] === "text" && typeof typed["text"] === "string"
            ? typed["text"]
            : "";
        })
        .filter(Boolean)
        .join("\n")
    : "";
}

function parseJsonText(text: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : null;
  } catch {
    return null;
  }
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
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

const { expectedWidth, expectedHeight } = parseDimensions(values.dimensions);

const client = new Client({
  name: "payspace-buyer-verifier",
  version: "1.0.0",
});
const transport = new StreamableHTTPClientTransport(new URL(`${PLAYWRIGHT_MCP_URL.replace(/\/+$/, "")}/mcp`));

let evaluation: JsonRecord | null = null;
let networkText = "";

try {
  await client.connect(transport as any);

  await callTool(client, "browser_navigate", { url: pageUrl });

  await callTool(client, "browser_wait_for", { time: 2 });

  await callTool(client, "browser_evaluate", {
    function: `() => {
      const el = document.getElementById(${JSON.stringify(elementId)});
      if (!el) return { found: false };
      el.scrollIntoView({ block: 'center', inline: 'center' });
      return { found: true };
    }`,
  });

  await callTool(client, "browser_wait_for", { time: 2 });

  const evaluateResult = await callTool(client, "browser_evaluate", {
    function: `() => {
      const el = document.getElementById(${JSON.stringify(elementId)});
      if (!el) return { found: false };
      const rect = el.getBoundingClientRect();
      const img = el.querySelector('img');
      const anchor = el.querySelector('a');
      const styles = window.getComputedStyle(el);
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      return {
        found: true,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        in_viewport: rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth,
        display: styles.display,
        visibility: styles.visibility,
        opacity: Number(styles.opacity || '0'),
        img_natural_w: img?.naturalWidth ?? 0,
        img_natural_h: img?.naturalHeight ?? 0,
        img_complete: img?.complete ?? false,
        img_src: img?.src ?? null,
        href: anchor?.href ?? null,
        top_element_id: topEl?.id ?? null,
        top_element_tag: topEl?.tagName ?? null
      };
    }`,
  });

  evaluation = parseJsonText(joinText(evaluateResult as { content?: unknown[] }));

  const networkResult = await callTool(client, "browser_network_requests", {
    includeStatic: true,
  });
  networkText = joinText(networkResult as { content?: unknown[] });

  await callTool(client, "browser_take_screenshot", {
    filename: screenshotFile,
  });
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: "playwright verification failed",
    detail: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
} finally {
  await transport.close().catch(() => undefined);
}

if (!evaluation) {
  process.stderr.write(JSON.stringify({
    error: "browser_evaluate did not return structured JSON",
  }) + "\n");
  process.exit(1);
}

const found = evaluation["found"] === true;
const width = Number(evaluation["width"] ?? 0);
const height = Number(evaluation["height"] ?? 0);
const inViewport = evaluation["in_viewport"] === true;
const display = String(evaluation["display"] ?? "");
const visibility = String(evaluation["visibility"] ?? "");
const opacity = Number(evaluation["opacity"] ?? 0);
const imgNaturalW = Number(evaluation["img_natural_w"] ?? 0);
const imgComplete = evaluation["img_complete"] === true;
const topElementId = typeof evaluation["top_element_id"] === "string" ? evaluation["top_element_id"] : null;
const topElementTag = typeof evaluation["top_element_tag"] === "string" ? evaluation["top_element_tag"] : null;

const geometryPass =
  found &&
  (expectedWidth === null || width >= expectedWidth * 0.8) &&
  (expectedHeight === null || height >= expectedHeight * 0.8) &&
  inViewport &&
  display !== "none" &&
  visibility !== "hidden" &&
  opacity > 0.1 &&
  imgNaturalW > 0 &&
  imgComplete;

const trackingNeedle = bookingId ? `booking_id=${bookingId}` : "/tracking/image";
const trackingConfirmed = networkText.includes("/tracking/image") && networkText.includes(trackingNeedle);

const coveringPass =
  !found
    ? false
    : topElementId === elementId || topElementTag === "IMG" || topElementTag === "A";

const verified = geometryPass && trackingConfirmed && coveringPass;

console.log(JSON.stringify({
  ok: true,
  verified,
  page_url: pageUrl,
  element_id: elementId,
  booking_id: bookingId,
  screenshot_file: screenshotFile,
  checks: {
    found,
    geometry_pass: geometryPass,
    covering_pass: coveringPass,
    tracking_confirmed: trackingConfirmed,
  },
  evaluation,
  network_excerpt: networkText.split("\n").slice(0, 50),
}));
