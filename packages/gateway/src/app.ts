// Single Express app — the only server on the block.
// Two categories of routes:
//   /a2a/*   — public, unauthenticated (buyers call in from outside)
//   /agents/* — management (no auth during testing phase)

import express from "express";
import a2aRouter from "./routes/a2a.js";
import agentsRouter from "./routes/agents.js";
import { config } from "./config.js";

const app = express();

// Parse JSON request bodies up front because every management and A2A route
// exchanges structured payloads.
app.use(express.json());

/**
 * Reports whether the gateway process is alive and able to accept requests.
 */
function handleHealthCheck(_req: express.Request, res: express.Response): void {
  res.json({ status: "ok" });
}

app.get("/health", handleHealthCheck);

// ── Public A2A routes ─────────────────────────────────────────────────────────
app.use("/a2a", a2aRouter);

// ── Agent management routes ───────────────────────────────────────────────────
app.use("/agents", agentsRouter);

export default app;

// suppress unused-import lint on config
void config;
