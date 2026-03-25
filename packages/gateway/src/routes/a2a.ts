import { Router, type Request, type Response } from "express";
import { getRegistry } from "../registry.js";
import { config } from "../config.js";
import type { AgentEntry } from "../registry.js";

const router = Router();

/**
 * Normalizes Express route params into a single string agent id.
 */
function getAgentIdParam(req: Request): string {
  const agentId = req.params.agentId;
  return Array.isArray(agentId) ? (agentId[0] ?? "") : (agentId ?? "");
}

/**
 * Resolves a target agent or sends a `404` if the gateway does not know it.
 */
function getAgentEntryOrRespond(req: Request, res: Response): AgentEntry | null {
  const entry = getRegistry().get(getAgentIdParam(req));
  if (!entry) {
    res.status(404).json({ error: "agent not found" });
    return null;
  }
  return entry;
}

// ── Block-level agent discovery ───────────────────────────────────────────────
//
// GET /a2a/.well-known/agents.json
//
// Lists all agents currently running on this block.
// Must be registered before /:agentId routes to avoid Express matching
// ".well-known" as an agentId.

/**
 * Lists every currently-registered agent and the block capabilities this
 * gateway exposes to external A2A callers.
 */
function handleListDiscoverableAgents(_req: Request, res: Response): void {
  const agents = getRegistry().list().map((entry) => ({
    agentId: entry.agentId,
    agentType: entry.agentType,
    a2aUrl: entry.a2aUrl,
    card: entry.card,
  }));
  res.json({
    agents,
    block: config.blockPublicUrl,
    capabilities: ["playwright-verification"],
  });
}

// ── Agent card ────────────────────────────────────────────────────────────────
//
// GET /a2a/:agentId/.well-known/agent-card.json

/**
 * Returns the public agent card for a single gateway-managed agent.
 */
function handleGetAgentCard(req: Request, res: Response): void {
  const entry = getAgentEntryOrRespond(req, res);
  if (!entry) return;

  res.json(entry.card);
}

// ── A2A message proxy ─────────────────────────────────────────────────────────
//
// POST /a2a/:agentId
//
// Accepts inbound A2A messages from remote buyer/seller agents and delivers
// them to the target agent via the OpenClaw Chat Completions HTTP endpoint.

/**
 * Proxies an inbound A2A request to the target agent through OpenClaw and
 * leaves conversation persistence to the agent itself.
 */
async function handleProxyA2aMessage(req: Request, res: Response): Promise<void> {
  const entry = getAgentEntryOrRespond(req, res);
  if (!entry) return;

  const body = req.body as { id?: unknown };

  try {
    const upstream = await fetch(
      `${config.openclawGatewayUrl}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.openclawGatewayToken}`,
          "x-openclaw-agent-id": entry.agentId,
          // No session key — A2A calls are stateless. Each JSON-RPC request is
          // independent; the agent reads SOUL.md for identity without a
          // session-bootstrapped persona interfering.
        },
        body: JSON.stringify({
          model: "openclaw",
          messages: [{ role: "user", content: JSON.stringify(req.body) }],
        }),
      },
    );

    const data: unknown = await upstream.json();
    res.status(upstream.status).json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      result: data,
    });
  } catch (err) {
    console.error(`[a2a] proxy error for ${req.params.agentId}:`, err);
    res.status(502).json({ error: "agent unreachable" });
  }
}

// ── Agent health passthrough ──────────────────────────────────────────────────

/**
 * Proxies the shared OpenClaw health endpoint so external callers can confirm
 * the backing agent runtime is reachable through this gateway.
 */
async function handleAgentHealth(req: Request, res: Response): Promise<void> {
  const entry = getAgentEntryOrRespond(req, res);
  if (!entry) return;

  try {
    const upstream = await fetch(`${config.openclawGatewayUrl}/health`, {
      headers: { "Authorization": `Bearer ${config.openclawGatewayToken}` },
    });
    const contentType = upstream.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json")
      ? await upstream.json()
      : await upstream.text();
    res.status(upstream.status).json(
      typeof data === "string" ? { message: data } : data
    );
  } catch {
    res.status(502).json({ error: "agent unreachable" });
  }
}

router.get("/.well-known/agents.json", handleListDiscoverableAgents);
router.get("/:agentId/.well-known/agent-card.json", handleGetAgentCard);
router.post("/:agentId", handleProxyA2aMessage);
router.get("/:agentId/health", handleAgentHealth);

export default router;
