import { Router, type Request, type Response } from "express";
import { listRecords, readRecord } from "../store.js";
import type { AgentBinding } from "../orchestration.js";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  const bindings = listRecords<AgentBinding>("agent_bindings");
  res.json({ total: bindings.length, bindings });
});

router.get("/:subjectType/:subjectId", (req: Request, res: Response) => {
  const subjectType = String(req.params.subjectType ?? "");
  const subjectId = String(req.params.subjectId ?? "");
  const binding = readRecord<AgentBinding>("agent_bindings", `${subjectType}:${subjectId}`);
  if (!binding) {
    res.status(404).json({ error: "agent binding not found" });
    return;
  }
  res.json(binding);
});

export default router;
