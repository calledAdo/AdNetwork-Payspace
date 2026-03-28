import express from "express";
import trackingRouter  from "./routes/tracking.js";
import snippetsRouter from "./routes/snippets.js";
import { createDeprecatedRouter } from "./routes/deprecated.js";

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

// Deprecated non-tracking scopes
app.use("/gateway-nodes", createDeprecatedRouter("gateway-nodes"));
app.use("/agent-bindings", createDeprecatedRouter("agent-bindings"));
app.use("/assistant", createDeprecatedRouter("assistant"));
app.use("/publishers", createDeprecatedRouter("publishers"));

// Standalone snippet provisioning and content updates
app.use("/snippets", snippetsRouter);

// Deprecated campaign scope
app.use("/campaigns", createDeprecatedRouter("campaigns"));

export default app;
