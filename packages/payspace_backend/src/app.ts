import express from "express";
import trackingRouter  from "./routes/tracking.js";
import publishersRouter from "./routes/publishers.js";
import campaignsRouter  from "./routes/campaigns.js";
import gatewayNodesRouter from "./routes/gateway_nodes.js";
import agentBindingsRouter from "./routes/agent_bindings.js";
import assistantRouter from "./routes/assistant.js";

const app = express();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
});

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", storage: "file" });
});

// Impression/click/geo tracking + ad snippet serving
app.use("/tracking", trackingRouter);

// Block gateways — one gateway per block
app.use("/gateway-nodes", gatewayNodesRouter);

// Subject -> hosted agent bindings
app.use("/agent-bindings", agentBindingsRouter);

// Frontend assistant control plane — backend-native replies or owner-routed agent chat
app.use("/assistant", assistantRouter);

// Publisher (seller) registration + seller agent lifecycle
app.use("/publishers", publishersRouter);

// Advertiser campaign creation + buyer agent lifecycle
app.use("/campaigns", campaignsRouter);

export default app;
