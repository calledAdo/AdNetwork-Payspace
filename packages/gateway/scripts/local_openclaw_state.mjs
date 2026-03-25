import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const gatewayRoot = path.resolve(here, "..");
export const stateDir = path.join(gatewayRoot, ".openclaw");
export const configPath = path.join(stateDir, "openclaw.json");
export const workspacesDir = path.join(gatewayRoot, "agent-workspaces");

/**
 * Reuses an existing auth-profiles store when a local gateway sandbox does not
 * have its own API credentials yet.
 */
function loadFallbackProfiles() {
  const candidates = [
    path.join(stateDir, "agents", "main", "agent", "auth-profiles.json"),
    path.join(os.homedir(), ".openclaw", "agents", "main", "agent", "auth-profiles.json"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (parsed && typeof parsed === "object" && parsed.profiles) return parsed;
    } catch {
      // keep looking
    }
  }

  return null;
}

/**
 * Ensures the local OpenClaw "main" agent has an auth-profiles store so local
 * gateway and OpenClaw commands can authenticate consistently.
 */
export function ensureLocalMainAuthStore(env = process.env) {
  const target = path.join(stateDir, "agents", "main", "agent", "auth-profiles.json");
  if (fs.existsSync(target)) return;

  const apiKey = env.OPENAI_API_KEY?.trim();
  const fallback = !apiKey ? loadFallbackProfiles() : null;

  if (!apiKey && !fallback) return;

  if (fallback) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(fallback, null, 2), { mode: 0o600 });
    return;
  }

  const profiles = {
    "openai:default": {
      provider: "openai",
      type: "api_key",
      key: apiKey,
    },
  };

  const baseUrl = env.OPENAI_BASE_URL?.trim();
  if (baseUrl) {
    profiles["share-ai:default"] = {
      provider: "share-ai",
      type: "api_key",
      key: apiKey,
    };
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ version: 1, profiles }, null, 2), {
    mode: 0o600,
  });
}
