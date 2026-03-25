import dotenv from "dotenv";

dotenv.config({
  path: new URL("../../../.env", import.meta.url).pathname,
  override: false,
});

function normalizeOpenAICompatibleBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

// Runtime configuration — all values read from environment variables.

export const config = {
  port:    Number(process.env.PORT ?? 4000),
  dataDir: process.env.DATA_DIR ?? "./packages/payspace_backend/data",

  // Public URL of the block gateway that hosts spawned agents.
  blockPublicUrl: process.env.BLOCK_PUBLIC_URL ?? "http://localhost:8080",
  // Bearer token the block gateway requires on spawn/management routes.
  blockApiKey: process.env.BLOCK_API_KEY ?? "",

  // Optional bearer token callers must send to mutating routes (publishers, campaigns).
  // Leave empty to disable auth in dev.
  apiKey: process.env.API_KEY ?? "",

  // Base URL of this backend — injected into agent init_config so agents
  // know where to reach the tracking and details APIs.
  backendUrl:  process.env.BACKEND_URL  ?? "http://localhost:4000",
  trackingUrl: process.env.TRACKING_URL ?? "http://localhost:4000",

  // Backend-side onboarding assistant LLM config.
  assistantApiBaseUrl: normalizeOpenAICompatibleBaseUrl(
    process.env.SCITELY_BASE_URL ??
      process.env.ASSISTANT_API_BASE_URL ??
      process.env.OPENAI_BASE_URL ??
      "https://share-ai.ckbdev.com",
  ),
  assistantApiKey:
    process.env.SCITELY_API_KEY ??
    process.env.ASSISTANT_API_KEY ??
    process.env.OPENAI_API_KEY ??
    "",
  assistantModel:
    process.env.SCITELY_MODEL ??
    process.env.ASSISTANT_MODEL ??
    "gpt-5-mini",
} as const;
