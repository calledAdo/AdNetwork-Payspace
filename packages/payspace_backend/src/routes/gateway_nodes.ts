import { Router, type Request, type Response } from "express";
import { listRecords, readRecord, writeRecord } from "../store.js";
import type { GatewayNode } from "../orchestration.js";

const router = Router();

function nowIso(): string {
  return new Date().toISOString();
}

router.post("/", (req: Request, res: Response) => {
  const blockId = String(req.body?.block_id ?? "").trim();
  const gatewayUrl = String(req.body?.gateway_url ?? "").trim();
  const gatewayApiKey = String(req.body?.block_api_key ?? req.body?.gateway_api_key ?? "");

  if (!blockId || !gatewayUrl) {
    res.status(400).json({ error: "block_id and gateway_url are required" });
    return;
  }

  const current = readRecord<GatewayNode>("gateway_nodes", blockId);
  const node: GatewayNode = {
    block_id: blockId,
    gateway_url: gatewayUrl,
    gateway_api_key: gatewayApiKey,
    status: "active",
    created_at: current?.created_at ?? nowIso(),
    updated_at: nowIso(),
  };

  writeRecord("gateway_nodes", blockId, node);
  res.status(201).json(node);
});

router.get("/", (_req: Request, res: Response) => {
  const nodes = listRecords<GatewayNode>("gateway_nodes");
  res.json({ total: nodes.length, gateway_nodes: nodes });
});

router.get("/:blockId", (req: Request, res: Response) => {
  const node = readRecord<GatewayNode>("gateway_nodes", String(req.params.blockId ?? ""));
  if (!node) {
    res.status(404).json({ error: "gateway node not found" });
    return;
  }
  res.json(node);
});

export default router;
