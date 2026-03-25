import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { config } from "./config.js";
import { getRegistry } from "./registry.js";
import type { AgentCard, AgentType } from "./registry.js";

/**
 * Declares the inputs needed to create a new gateway-managed agent workspace.
 */
export interface SpawnOptions {
  agentType: AgentType;
  // Additional init config passed to the agent via its memory file on first boot.
  // For seller: priceFloor, keywordFlags, adPosition, publicationMode, siteUrl, dimensions, elementId
  // For buyer: campaignId, totalBudgetUdt, maxPricePerMille, keywordFlags, adPosition
  initConfig?: Record<string, unknown> | undefined;
  // Dynamic OpenClaw system prompts to overwrite the template defaults (e.g. SOUL.md, IDENTITY.md)
  initialProfile?: Record<string, string> | undefined;
}

/**
 * Describes the routing and identity details returned after a successful spawn.
 */
export interface SpawnResult {
  agentId: string;
  pubkey: string;
  blake160: string;
  a2aUrl: string;
}

/**
 * Prefixes an OpenClaw command with the configured profile when the gateway is
 * managing its own isolated OpenClaw state tree.
 */
function withOpenclawProfile(args: string[]): string[] {
  return config.openclawProfile
    ? ["--profile", config.openclawProfile, ...args]
    : args;
}

/**
 * Builds the environment block that points OpenClaw commands at this gateway's
 * dedicated state and config files.
 */
function openclawEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OPENCLAW_STATE_DIR: config.openclawStateDir,
    OPENCLAW_CONFIG_PATH: config.openclawConfigPath,
  };
}

/**
 * Resolves a template helper script, preferring compiled `.mjs` output while
 * still supporting `.mts` files during source-only development.
 */
function resolveTemplateScript(templateDir: string, basename: string): string {
  const mjs = path.join(templateDir, "scripts", `${basename}.mjs`);
  if (fs.existsSync(mjs)) return mjs;

  const mts = path.join(templateDir, "scripts", `${basename}.mts`);
  if (fs.existsSync(mts)) return mts;

  throw new Error(`missing template script: ${basename}.mts|.mjs in ${templateDir}/scripts`);
}

/**
 * Loads previously-created auth profiles from the gateway-local or user-level
 * OpenClaw state so new workspaces can inherit usable credentials.
 */
function loadFallbackAuthProfiles():
  | { version?: number; profiles: Record<string, { provider: string; type?: string; key?: string; token?: string }> }
  | null {
  const candidates = [
    path.join(config.openclawStateDir, "agents", "main", "agent", "auth-profiles.json"),
    path.join(os.homedir(), ".openclaw", "agents", "main", "agent", "auth-profiles.json"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as {
        version?: number;
        profiles: Record<string, { provider: string; type?: string; key?: string; token?: string }>;
      };
      if (parsed && typeof parsed === "object" && parsed.profiles) return parsed;
    } catch {
      // keep looking
    }
  }

  return null;
}

/**
 * Builds the auth-profiles payload that should be materialized into new agent
 * workspaces and OpenClaw per-agent state directories.
 */
function buildAuthProfilesPayload(): { version: 1; profiles: Record<string, { provider: string; type: "api_key"; key: string }> } | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    const fallback = loadFallbackAuthProfiles();
    if (!fallback) return null;
    return {
      version: 1,
      profiles: Object.fromEntries(
        Object.entries(fallback.profiles).flatMap(([profileId, profile]) => {
          const key = profile.key?.trim() || profile.token?.trim();
          if (!key) return [];
          return [[profileId, { provider: profile.provider, type: "api_key" as const, key }]];
        }),
      ),
    };
  }

  const profiles: Record<string, { provider: string; type: "api_key"; key: string }> = {
    "openai:default": {
      provider: "openai",
      type: "api_key",
      key: apiKey,
    },
  };

  const baseUrl = process.env.OPENAI_BASE_URL?.trim();
  if (baseUrl) {
    profiles["share-ai:default"] = {
      provider: "share-ai",
      type: "api_key",
      key: apiKey,
    };
  }

  return { version: 1, profiles };
}

/**
 * Writes an auth-profiles file once, preserving any file that already exists.
 */
function writeAuthProfilesFile(target: string): void {
  if (fs.existsSync(target)) return;

  const payload = buildAuthProfilesPayload();
  if (!payload) return;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

/**
 * Mirrors gateway auth configuration into the visible agent workspace so local
 * debugging reflects the credentials the agent actually has available.
 */
function writeWorkspaceAuthProfiles(agentDir: string): void {
  writeAuthProfilesFile(path.join(agentDir, "auth-profiles.json"));
}

/**
 * Mirrors gateway auth configuration into OpenClaw's per-agent state tree,
 * which is where the runtime resolves credentials during execution.
 */
function writeOpenclawAgentAuthProfiles(agentId: string): void {
  writeAuthProfilesFile(
    path.join(config.openclawStateDir, "agents", agentId, "agent", "auth-profiles.json"),
  );
}

/**
 * Resolves the OpenClaw state directory that belongs to one spawned agent.
 */
function getOpenclawAgentStateDir(agentId: string): string {
  return path.join(config.openclawStateDir, "agents", agentId);
}

/**
 * Removes a directory tree when it exists, skipping silently when it does not.
 */
function removeDirIfExists(target: string): void {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Creates a new agent workspace from a template, generates its key material,
 * registers it with OpenClaw, and adds it to the gateway registry.
 */
export async function spawnAgent(opts: SpawnOptions): Promise<SpawnResult> {
  const { agentType, initConfig = {}, initialProfile } = opts;
  const registry = getRegistry();

  // The short UUID keeps ids unique while still being readable in logs,
  // workspace folder names, and HTTP URLs.
  const agentId = `agent_${uuidv4().replace(/-/g, "").slice(0, 12)}`;
  const agentDir = path.resolve(config.agentsDir, agentId);
  const a2aUrl = `${config.blockPublicUrl}/a2a/${agentId}`;

  // 1. Create agent working directory
  fs.mkdirSync(agentDir, { recursive: true });

  // 2. Copy template files — skip node_modules (agents share the block-level install)
  const templateDir = path.join(config.agentTemplatesDir, agentType);
  copyDirSync(templateDir, agentDir);

  // 3. Generate keypair — writes keyfile (chmod 600) and pubkey JSON file.
  // Prefer compiled .mjs scripts so runtime does not depend on tsx.
  // Pass --dir so it writes keyfile/pubkey into the agent's working directory.
  const genScript = resolveTemplateScript(templateDir, "gen_keypair");
  const keypairCommand = genScript.endsWith(".mjs")
    ? process.execPath
    : path.join(path.dirname(process.execPath), "npx");
  const keypairArgs = genScript.endsWith(".mjs")
    ? [genScript, "--dir", agentDir]
    : ["tsx", genScript, "--dir", agentDir];

  const keypairResult = spawnSync(keypairCommand, keypairArgs, {
    cwd:      templateDir,
    encoding: "utf8",
    env:      { ...process.env },
  });

  if (keypairResult.status !== 0) {
    fs.rmSync(agentDir, { recursive: true, force: true });
    throw new Error(`gen_keypair failed: ${keypairResult.stderr || keypairResult.stdout}`);
  }

  const { pubkey, blake160 } = JSON.parse(
    fs.readFileSync(path.join(agentDir, "pubkey"), "utf8")
  ) as { pubkey: string; blake160: string };

  // 4. Fill in agent card template
  const cardTemplatePath = path.join(agentDir, "AGENT_CARD.json");
  const card = JSON.parse(fs.readFileSync(cardTemplatePath, "utf8")) as AgentCard;
  card.url    = a2aUrl;
  card.pubkey = pubkey;
  fs.writeFileSync(cardTemplatePath, JSON.stringify(card, null, 2));

  // 5. Persist agentType for recovery
  fs.writeFileSync(path.join(agentDir, "agent_type"), agentType);

  // 5.5 Inject Dynamic Profile Overrides (SOUL.md, IDENTITY.md, etc.)
  // Only markdown and JSON files are allowed here so callers can override
  // profile content without unexpectedly writing arbitrary executables.
  if (initialProfile) {
    for (const [filename, content] of Object.entries(initialProfile)) {
      if (filename.endsWith(".md") || filename.endsWith(".json")) {
        fs.writeFileSync(path.join(agentDir, filename), content, "utf8");
      }
    }
  }

  // 6. Write initial agent memory
  const memoryDir = path.join(agentDir, "memory");
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(path.join(memoryDir, "conversations"), { recursive: true });
  fs.mkdirSync(path.join(memoryDir, "reports", "daily"), { recursive: true });
  fs.mkdirSync(path.join(memoryDir, "reports", "placements"), { recursive: true }); // buyer
  fs.mkdirSync(path.join(memoryDir, "reports", "slots"), { recursive: true });      // seller
  fs.mkdirSync(path.join(memoryDir, "tickets"), { recursive: true });

  fs.writeFileSync(
    path.join(memoryDir, "init_config.json"),
    JSON.stringify(
      {
        ...initConfig,
        agentId,
        agentType,
        gateway_url: a2aUrl,
        a2aUrl,
        pubkey,
        blake160,
      },
      null,
      2
    )
  );

  // 6.5 Materialize a visible auth-profiles.json in the workspace when the
  // gateway has API credentials available. This keeps spawned workspaces
  // self-describing during debugging and matches what operators expect to see.
  writeWorkspaceAuthProfiles(agentDir);

  // 7. Register this agent with the system OpenClaw gateway.
  //    openclaw agents add {agentId} --workspace {agentDir} --agent-dir {agentDir} --non-interactive
  //    This adds the agent to the system openclaw.json (agents.list) so the
  //    running gateway can route requests to it via x-openclaw-agent-id header.
  const addResult = spawnSync(
    config.openclawBin,
    withOpenclawProfile([
      "agents", "add", agentId,
      "--workspace",       agentDir,
      "--agent-dir",       agentDir,
      "--non-interactive",
    ]),
    {
      encoding: "utf8",
      env:      openclawEnv(),
    }
  );

  if (addResult.status !== 0) {
    fs.rmSync(agentDir, { recursive: true, force: true });
    throw new Error(`openclaw agents add failed: ${addResult.stderr || addResult.stdout}`);
  }

  // OpenClaw resolves per-agent auth from its state directory, not just the
  // workspace root, so materialize the same generated auth there as well.
  writeOpenclawAgentAuthProfiles(agentId);

  // openclaw agents add creates USER.md and TOOLS.md in the workspace.
  // Remove only USER.md: a blank USER file can trigger onboarding instead of
  // using SOUL.md, while TOOLS.md is useful because it exposes the default tool
  // surface, including exec when the OpenClaw tool profile provides it.
  const userFile = path.join(agentDir, "USER.md");
  if (fs.existsSync(userFile)) fs.rmSync(userFile);

  // 8. Register in-memory routing table
  registry.register({
    agentId,
    agentType,
    agentDir,
    pubkey,
    blake160,
    a2aUrl,
    card,
    spawnedAt: new Date(),
  });

  console.log(`[gateway] spawned ${agentType} agent ${agentId}`);

  return { agentId, pubkey, blake160, a2aUrl };
}

/**
 * Fully deletes a registered agent by removing it from OpenClaw, deleting its
 * workspace plus per-agent OpenClaw state, and dropping it from the registry.
 */
export function terminateAgent(agentId: string): void {
  const registry = getRegistry();
  const entry = registry.get(agentId);
  if (!entry) throw new Error(`Agent ${agentId} not found`);

  // Remove from system OpenClaw config first. If this fails we keep the local
  // workspace and registry entry untouched so the agent is not half-deleted.
  const deleteResult = spawnSync(
    config.openclawBin,
    withOpenclawProfile(["agents", "delete", agentId, "--force"]),
    {
      encoding: "utf8",
      env: openclawEnv(),
    }
  );

  if (deleteResult.status !== 0) {
    throw new Error(
      `openclaw agents delete failed: ${deleteResult.stderr || deleteResult.stdout}`,
    );
  }

  // Hard delete the on-disk workspace so recoverOrphanedAgents() cannot bring
  // this agent back on the next gateway restart.
  removeDirIfExists(entry.agentDir);

  // OpenClaw stores per-agent auth and runtime state outside the workspace,
  // so remove that state tree as part of the same hard-delete operation.
  removeDirIfExists(getOpenclawAgentStateDir(agentId));

  registry.remove(agentId);
  console.log(`[gateway] terminated agent ${agentId}`);
}

// Re-populate the in-memory registry from agent directories that exist on disk.
// Called at gateway startup. Since agents are registered in the system openclaw config,
// we only need to reload the in-memory table — no process management needed.
/**
 * Reconstructs registry entries for agent workspaces that already exist on
 * disk so a gateway restart does not orphan still-valid agents.
 */
export async function recoverOrphanedAgents(): Promise<void> {
  if (!fs.existsSync(config.agentsDir)) return;

  const entries = fs.readdirSync(config.agentsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const agentDir      = path.join(config.agentsDir, entry.name);
    const pubkeyFile    = path.join(agentDir, "pubkey");
    const cardFile      = path.join(agentDir, "AGENT_CARD.json");
    const agentTypeFile = path.join(agentDir, "agent_type");

    if (
      !fs.existsSync(pubkeyFile)  ||
      !fs.existsSync(cardFile)    ||
      !fs.existsSync(agentTypeFile)
    ) continue;

    try {
      const { pubkey, blake160 } = JSON.parse(fs.readFileSync(pubkeyFile, "utf8")) as { pubkey: string; blake160: string };
      const card                 = JSON.parse(fs.readFileSync(cardFile, "utf8")) as AgentCard;
      const agentType            = fs.readFileSync(agentTypeFile, "utf8").trim() as AgentType;
      const agentId              = entry.name;
      const a2aUrl               = card.url;

      getRegistry().register({
        agentId, agentType, agentDir, pubkey, blake160, a2aUrl, card,
        spawnedAt: new Date(fs.statSync(agentDir).birthtime),
      });

      console.log(`[gateway] recovered agent ${agentId} (${agentType})`);
    } catch (err) {
      console.log(`[gateway] could not recover ${entry.name}:`, err);
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

// Copy src to dest, skipping node_modules entirely.
/**
 * Recursively copies a template directory into a fresh agent workspace while
 * skipping generated artifacts, auth files, and heavyweight dependencies.
 */
function copyDirSync(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    if (entry.name === "auth-profiles.json") continue;
    if (entry.name.endsWith(".d.mts")) continue;
    if (entry.name.endsWith(".map")) continue;
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      if (entry.name.endsWith(".mts") || entry.name.endsWith(".mjs")) fs.chmodSync(destPath, 0o755);
    }
  }
}
