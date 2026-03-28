import { startPlaywrightServer, stopPlaywrightServer } from "./server.js";

function handleSigterm(): void {
  console.log("[playwright-server] SIGTERM — shutting down");
  stopPlaywrightServer();
  setTimeout(() => process.exit(0), 500).unref();
}

function handleSigint(): void {
  process.kill(process.pid, "SIGTERM");
}

process.on("SIGTERM", handleSigterm);
process.on("SIGINT", handleSigint);

startPlaywrightServer().catch((err) => {
  console.error("[playwright-server] failed to start:", err);
  process.exit(1);
});
