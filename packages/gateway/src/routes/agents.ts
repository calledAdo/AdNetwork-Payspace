import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { getRegistry } from "../registry.js";
import { spawnAgent, terminateAgent } from "../spawner.js";
import { config } from "../config.js";
import {
  BuyerPlacementsFileSchema,
  ConversationLogSchema,
  InitConfigSchema,
  SellerSlotsFileSchema,
  StatsSchema,
} from "../agent_memory_schemas.js";
import type { AgentEntry, AgentType } from "../registry.js";

const router = Router();

type SpawnRequestBody = {
  type?: string;
  initConfig?: Record<string, unknown>;
  initialProfile?: Record<string, string>;
};

type ChatRequestBody = {
  message?: string;
};

type CommandRequestBody = {
  command?: string;
  params?: unknown;
};

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Reads a JSON file and returns `null` when the file is missing or malformed.
 * The routes use this for operator-facing inspection endpoints where partial
 * data is better than failing the whole response.
 */
function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function formatZodIssues(filePath: string, issues: Array<{ path: PropertyKey[]; message: string }>): string[] {
  return issues.map((issue) => {
    const suffix = issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
    return `${filePath}${suffix}: ${issue.message}`;
  });
}

function readSchemaFile<T>(
  filePath: string,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } },
): { data: T | null; warnings: string[] } {
  const parsed = readJsonFile(filePath);
  if (parsed == null) return { data: null, warnings: [] };
  const result = schema.safeParse(parsed);
  if (result.success) {
    return { data: result.data, warnings: [] };
  }
  return {
    data: null,
    warnings: formatZodIssues(filePath, result.error.issues),
  };
}

/**
 * Lists JSON files in a directory in stable order so conversation summaries are
 * returned predictably across requests.
 */
function listJsonFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

/**
 * Normalizes Express route params into a single string agent id.
 */
function getAgentIdParam(req: Request): string {
  const agentId = req.params.agentId;
  return Array.isArray(agentId) ? (agentId[0] ?? "") : (agentId ?? "");
}

/**
 * Resolves an agent from the registry and sends a `404` response when the id
 * is unknown, letting route handlers stay focused on their primary work.
 */
function getAgentEntryOrRespond(req: Request, res: Response): AgentEntry | null {
  const entry = getRegistry().get(getAgentIdParam(req));
  if (!entry) {
    res.status(404).json({ error: "agent not found" });
    return null;
  }
  return entry;
}

// ── POST /agents/spawn ────────────────────────────────────────────────────────

/**
 * Spawns a new agent workspace from one of the built-in gateway templates.
 */
async function handleSpawnAgent(req: Request, res: Response): Promise<void> {
  const body = req.body as SpawnRequestBody;

  try {
    const result = await spawnAgent({
      agentType: (body.type ?? "buyer") as AgentType,
      initConfig: body.initConfig,
      initialProfile: body.initialProfile,
    });
    res.status(201).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[gateway] spawn failed:", message);
    res.status(500).json({ error: message });
  }
}

// ── GET /agents ───────────────────────────────────────────────────────────────

/**
 * Lists the lightweight metadata operators usually need when browsing active
 * agents in the gateway.
 */
function handleListAgents(_req: Request, res: Response): void {
  const agents = getRegistry()
    .list()
    .map((entry) => ({
      agentId: entry.agentId,
      agentType: entry.agentType,
      pubkey: entry.pubkey,
      blake160: entry.blake160,
      a2aUrl: entry.a2aUrl,
      spawnedAt: entry.spawnedAt.toISOString(),
    }));
  res.json(agents);
}

// ── GET /agents/:agentId ──────────────────────────────────────────────────────

/**
 * Returns the full registry entry for a single agent, including its workspace
 * path and rendered agent card.
 */
function handleGetAgent(req: Request, res: Response): void {
  const entry = getAgentEntryOrRespond(req, res);
  if (!entry) return;

  res.json({
    agentId: entry.agentId,
    agentType: entry.agentType,
    pubkey: entry.pubkey,
    blake160: entry.blake160,
    a2aUrl: entry.a2aUrl,
    agentDir: entry.agentDir,
    spawnedAt: entry.spawnedAt.toISOString(),
    card: entry.card,
  });
}

// ── GET /agents/:agentId/metrics ──────────────────────────────────────────────

/**
 * Returns the agent's persisted runtime state, choosing placement or slot
 * inventory based on the agent type.
 */
function handleGetAgentMetrics(req: Request, res: Response): void {
  const entry = getAgentEntryOrRespond(req, res);
  if (!entry) return;

  const memDir = path.join(entry.agentDir, "memory");
  const warnings: string[] = [];
  const initConfigResult = readSchemaFile(
    path.join(memDir, "init_config.json"),
    InitConfigSchema,
  );
  warnings.push(...initConfigResult.warnings);
  const statsResult = readSchemaFile(path.join(memDir, "stats.json"), StatsSchema);
  warnings.push(...statsResult.warnings);
  const base = {
    agentId: entry.agentId,
    agentType: entry.agentType,
    initConfig: initConfigResult.data,
    stats: statsResult.data ?? {},
  };

  if (entry.agentType === "seller") {
    const slotsResult = readSchemaFile(
      path.join(memDir, "slots.json"),
      SellerSlotsFileSchema,
    );
    warnings.push(...slotsResult.warnings);
    res.json({
      ...base,
      slots: slotsResult.data ?? [],
      ...(warnings.length > 0 ? { warnings } : {}),
    });
    return;
  }

  const placementsResult = readSchemaFile(
    path.join(memDir, "placements.json"),
    BuyerPlacementsFileSchema,
  );
  warnings.push(...placementsResult.warnings);
  res.json({
    ...base,
    placements: placementsResult.data ?? [],
    ...(warnings.length > 0 ? { warnings } : {}),
  });
}

// ── GET /agents/:agentId/conversations ────────────────────────────────────────

/**
 * Summarizes every persisted conversation file for an agent without returning
 * the full message bodies.
 */
function handleListConversations(req: Request, res: Response): void {
  const entry = getAgentEntryOrRespond(req, res);
  if (!entry) return;

  const convDir = path.join(entry.agentDir, "memory", "conversations");
  const files = listJsonFiles(convDir);
  const warnings: string[] = [];
  const conversations = files.map((fileName) => {
    const filePath = path.join(convDir, fileName);
    const parsed = readSchemaFile(filePath, ConversationLogSchema);
    warnings.push(...parsed.warnings);
    const data = parsed.data;
    return {
      contextId: data?.contextId ?? fileName.replace(".json", ""),
      status: data?.status ?? "invalid",
      startedAt: data?.startedAt ?? null,
      endedAt: data?.endedAt ?? null,
      messageCount: data?.messages?.length ?? 0,
      hasSummary: data?.summary != null,
    };
  });
  res.json({
    agentId: entry.agentId,
    conversations,
    ...(warnings.length > 0 ? { warnings } : {}),
  });
}

// ── GET /agents/:agentId/conversations/:contextId ─────────────────────────────

/**
 * Returns the raw persisted conversation log for a specific context id.
 */
function handleGetConversation(req: Request, res: Response): void {
  const entry = getAgentEntryOrRespond(req, res);
  if (!entry) return;

  const filePath = path.join(
    entry.agentDir,
    "memory",
    "conversations",
    `${req.params.contextId ?? ""}.json`,
  );
  const parsed = readSchemaFile(filePath, ConversationLogSchema);
  if (!parsed.data && parsed.warnings.length === 0) {
    res.status(404).json({ error: "conversation not found" });
    return;
  }
  if (!parsed.data) {
    res.status(502).json({
      error: "conversation file failed validation",
      warnings: parsed.warnings,
    });
    return;
  }
  res.json(parsed.data);
}

// ── POST /agents/:agentId/chat ────────────────────────────────────────────────

/**
 * Sends an operator-authored user message into an agent's owner session via
 * the shared OpenClaw chat completions endpoint.
 */
async function handleAgentChat(req: Request, res: Response): Promise<void> {
  const entry = getAgentEntryOrRespond(req, res);
  if (!entry) return;

  const { message } = req.body as ChatRequestBody;

  try {
    const upstream = await fetch(
      `${config.openclawGatewayUrl}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.openclawGatewayToken}`,
          "x-openclaw-agent-id": entry.agentId,
          "x-openclaw-session-key": `owner:${entry.agentId}`,
        },
        body: JSON.stringify({
          model: "openclaw",
          messages: [{ role: "user", content: message ?? "" }],
        }),
      },
    );
    const data: unknown = await upstream.json();
    res.status(upstream.status).json(data);
  } catch {
    res.status(502).json({ error: "agent unreachable" });
  }
}

// ── POST /agents/:agentId/command ─────────────────────────────────────────────

/**
 * Sends a structured system-style command to the agent through a dedicated
 * OpenClaw session key used for automation and tool orchestration.
 */
async function handleAgentCommand(req: Request, res: Response): Promise<void> {
  const entry = getAgentEntryOrRespond(req, res);
  if (!entry) return;

  const body = req.body as CommandRequestBody;
  const commandMessage = body.params
    ? `COMMAND: ${body.command ?? ""}\n${JSON.stringify(body.params, null, 2)}`
    : `COMMAND: ${body.command ?? ""}`;

  try {
    const upstream = await fetch(
      `${config.openclawGatewayUrl}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.openclawGatewayToken}`,
          "x-openclaw-agent-id": entry.agentId,
          "x-openclaw-session-key": `system:${entry.agentId}`,
        },
        body: JSON.stringify({
          model: "openclaw",
          messages: [{ role: "user", content: commandMessage }],
        }),
      },
    );
    const data: unknown = await upstream.json();
    res.status(upstream.status).json(data);
  } catch {
    res.status(502).json({ error: "agent unreachable" });
  }
}

// ── DELETE /agents/:agentId ───────────────────────────────────────────────────

/**
 * Terminates a gateway-managed agent and removes its routing entry.
 */
function handleDeleteAgent(req: Request, res: Response): void {
  try {
    terminateAgent(getAgentIdParam(req));
    res.json({ terminated: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 500;
    res.status(status).json({ error: message });
  }
}

router.post("/spawn", handleSpawnAgent);
router.get("/", handleListAgents);
router.get("/:agentId", handleGetAgent);
router.get("/:agentId/metrics", handleGetAgentMetrics);
router.get("/:agentId/conversations", handleListConversations);
router.get("/:agentId/conversations/:contextId", handleGetConversation);
router.post("/:agentId/chat", handleAgentChat);
router.post("/:agentId/command", handleAgentCommand);
router.delete("/:agentId", handleDeleteAgent);

export default router;
