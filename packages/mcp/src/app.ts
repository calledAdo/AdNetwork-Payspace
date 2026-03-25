import express from "express";
import transactionsRouter from "./routes/transactions.js";
import cellsRouter from "./routes/cells.js";
import placementsRouter from "./routes/placements.js";
import discoverRouter from "./routes/discover.js";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/transactions", transactionsRouter);
app.use("/cells", cellsRouter);
app.use("/placements", placementsRouter);
app.use("/discover", discoverRouter);

export default app;
