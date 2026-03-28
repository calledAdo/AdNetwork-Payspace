#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const openclawDir = path.join(rootDir, ".openclaw");
const openclawConfigPath = path.join(openclawDir, "openclaw.json");
/** Legacy layout — removed on init when present. */
const legacyWorkspaceDir = path.join(openclawDir, "workspace");
const agentWorkplaceDir = path.join(openclawDir, "agent-workplace");
/** OpenClaw `workspace` for `main`: profile .md templates + `skills/`. */
const mainWorkspaceDir = path.join(agentWorkplaceDir, "main-workplace");
const mainAgentDir = path.join(openclawDir, "agents", "main", "agent");
const templateMap = {
  buyer: path.join(rootDir, "packages", "workspaces", "default_buyer"),
  seller: path.join(rootDir, "packages", "workspaces", "default_seller"),
};
const skillsSourceDir = path.join(rootDir, "packages", "skills");
const workspaceSkillsDir = path.join(mainWorkspaceDir, "skills");

const DEFAULT_GATEWAY_TOKEN = "payspace-gateway-local-token";
const DEFAULT_PRIMARY_MODEL = "share-ai/gpt-5.3-codex";

function usage() {
  console.log(`Usage: node scripts/init_openclaw_workspace.mjs [options]

Options:
  --template <buyer|seller>   Non-interactive template selection
  --yes                        Accept defaults for prompts
  -h, --help                   Show this message
`);
}

function parseArgs(argv) {
  let template = null;
  let yes = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--template") {
      template = (argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (arg === "--yes") {
      yes = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    throw new Error(`unknown option: ${arg}`);
  }
  return { template, yes };
}

function copyDirSync(src, dest, opts = {}) {
  const { overwrite = true, filter = () => true } = opts;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!filter(entry.name, src, dest)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath, { overwrite, filter });
      continue;
    }
    if (!overwrite && fs.existsSync(destPath)) continue;
    fs.copyFileSync(srcPath, destPath);
  }
}

function removeDirContents(targetDir) {
  if (!fs.existsSync(targetDir)) return;
  for (const entry of fs.readdirSync(targetDir)) {
    const p = path.join(targetDir, entry);
    fs.rmSync(p, { recursive: true, force: true });
  }
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function toolPolicyForAgentType(agentType) {
  if (agentType === "buyer" || agentType === "seller") {
    return {
      allow: ["read", "write", "exec"],
      deny: ["edit", "apply_patch", "browser", "canvas", "nodes"],
    };
  }
  return undefined;
}

function buildDefaultConfig(env, selectedTemplate) {
  const policy = toolPolicyForAgentType(selectedTemplate);
  return {
    meta: {
      lastTouchedVersion: "2026.3.13",
      lastTouchedAt: nowIso(),
    },
    auth: {
      profiles: {},
    },
    models: {
      providers: {},
    },
    agents: {
      defaults: {
        model: {
          primary: DEFAULT_PRIMARY_MODEL,
        },
        models: {
          [DEFAULT_PRIMARY_MODEL]: {
            alias: "GPT",
          },
        },
        sandbox: {
          mode: "off",
          workspaceAccess: "rw",
          scope: "agent",
        },
        workspace: mainWorkspaceDir,
      },
      list: [
        {
          id: "main",
          workspace: mainWorkspaceDir,
          agentDir: mainAgentDir,
          ...(policy ? { tools: policy } : {}),
        },
      ],
    },
    tools: {
      profile: "coding",
    },
    commands: {
      native: false,
      nativeSkills: false,
      restart: true,
      ownerDisplay: "raw",
    },
    gateway: {
      port: Number(env.OPENCLAW_GATEWAY_PORT ?? 18889),
      mode: "local",
      bind: "loopback",
      auth: {
        mode: "token",
        token: env.OPENCLAW_GATEWAY_TOKEN?.trim() || DEFAULT_GATEWAY_TOKEN,
      },
      http: {
        endpoints: {
          chatCompletions: {
            enabled: true,
          },
        },
      },
    },
  };
}

function mergeOpenclawConfig(existing, env, selectedTemplate) {
  const base = buildDefaultConfig(env, selectedTemplate);
  const current = existing && typeof existing === "object" ? existing : {};
  const currentAgents =
    current.agents && typeof current.agents === "object" && !Array.isArray(current.agents)
      ? current.agents
      : {};
  const currentList = Array.isArray(currentAgents.list) ? currentAgents.list : [];
  const withoutMain = currentList.filter((entry) => entry && entry.id !== "main");
  return {
    ...base,
    ...current,
    meta: {
      ...(base.meta || {}),
      ...((current.meta && typeof current.meta === "object") ? current.meta : {}),
      lastTouchedVersion: "2026.3.13",
      lastTouchedAt: nowIso(),
    },
    agents: {
      ...base.agents,
      ...currentAgents,
      defaults: {
        ...(base.agents?.defaults || {}),
        ...((currentAgents.defaults && typeof currentAgents.defaults === "object")
          ? currentAgents.defaults
          : {}),
        workspace: mainWorkspaceDir,
      },
      list: [
        {
          id: "main",
          workspace: mainWorkspaceDir,
          agentDir: mainAgentDir,
          ...(toolPolicyForAgentType(selectedTemplate)
            ? { tools: toolPolicyForAgentType(selectedTemplate) }
            : {}),
        },
        ...withoutMain,
      ],
    },
    commands: {
      ...base.commands,
      ...((current.commands && typeof current.commands === "object") ? current.commands : {}),
      restart: true,
      ownerDisplay: "raw",
    },
  };
}

/**
 * Creates auth-profiles.json with empty `key` placeholders when missing.
 * Existing files are left unchanged so real keys are never overwritten.
 */
function ensureMainAuthProfiles(env) {
  const authProfilesPath = path.join(mainAgentDir, "auth-profiles.json");
  if (fs.existsSync(authProfilesPath)) return;

  const profiles = {
    "openai:default": {
      provider: "openai",
      type: "api_key",
      key: "",
    },
  };
  const baseUrl = env.OPENAI_BASE_URL?.trim();
  if (baseUrl) {
    profiles["share-ai:default"] = {
      provider: "share-ai",
      type: "api_key",
      key: "",
    };
  }

  fs.mkdirSync(path.dirname(authProfilesPath), { recursive: true });
  fs.writeFileSync(
    authProfilesPath,
    JSON.stringify({ version: 1, profiles }, null, 2),
    { mode: 0o600 },
  );
}

function printAuthSetupReminder() {
  const rel = path.relative(rootDir, path.join(mainAgentDir, "auth-profiles.json"));
  console.log("");
  console.log("[openclaw:init] Set your LLM API key(s) before using the agent:");
  console.log(`  • Edit ${rel} (repo-root path) and set each profile's "key" (currently empty).`);
  console.log("  • For the default primary model (share-ai/...), fill share-ai:default (and openai:default if you use it).");
  console.log("  • OPENAI_BASE_URL in repo-root .env should match your OpenAI-compatible endpoint; restart OpenClaw after editing auth-profiles.");
  console.log("");
}

function discoverAllSkills() {
  const entries = fs.readdirSync(skillsSourceDir, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith(".") && name !== "node_modules")
    .sort();

  return names.map((name) => ({
    name,
    source: `skills/${name}`,
  }));
}

function copySkillsPackageJson() {
  const src = path.join(skillsSourceDir, "package.json");
  const raw = fs.readFileSync(src, "utf8");
  const pkg = JSON.parse(raw);
  if (
    pkg.dependencies &&
    typeof pkg.dependencies === "object" &&
    pkg.dependencies.ckb_payspace_mcp === "file:../ckb_payspace_mcp"
  ) {
    pkg.dependencies.ckb_payspace_mcp = "file:../../packages/ckb_payspace_mcp";
  }
  fs.writeFileSync(
    path.join(agentWorkplaceDir, "package.json"),
    `${JSON.stringify(pkg, null, 2)}\n`,
  );
}

function writeSkillsJson() {
  const required = discoverAllSkills();
  const payload = {
    required,
    optional: [],
    counterparty_required: ["payment_channel", "slot_v1"],
  };
  fs.writeFileSync(
    path.join(mainWorkspaceDir, "skills.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

function copySkillsTree() {
  removeDirContents(workspaceSkillsDir);
  copyDirSync(skillsSourceDir, workspaceSkillsDir, {
    filter: (name) => name !== "node_modules",
  });
}

async function chooseTemplate(args) {
  if (args.template && templateMap[args.template]) return args.template;
  if (args.template && !templateMap[args.template]) {
    throw new Error(`invalid template: ${args.template} (expected buyer or seller)`);
  }
  if (args.yes) return "buyer";

  const rl = readline.createInterface({ input, output });
  try {
    const answer = (await rl.question("Choose workspace template [buyer/seller]: ")).trim().toLowerCase();
    if (!templateMap[answer]) {
      throw new Error("invalid selection; choose buyer or seller");
    }
    return answer;
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selectedTemplate = await chooseTemplate(args);
  const templateDir = templateMap[selectedTemplate];

  fs.mkdirSync(openclawDir, { recursive: true });
  fs.mkdirSync(path.join(openclawDir, "agents"), { recursive: true });
  fs.mkdirSync(mainAgentDir, { recursive: true });

  if (fs.existsSync(legacyWorkspaceDir)) {
    fs.rmSync(legacyWorkspaceDir, { recursive: true, force: true });
    console.log(`[openclaw:init] removed legacy ${legacyWorkspaceDir}`);
  }
  fs.rmSync(agentWorkplaceDir, { recursive: true, force: true });
  fs.mkdirSync(agentWorkplaceDir, { recursive: true });
  copySkillsPackageJson();
  fs.mkdirSync(mainWorkspaceDir, { recursive: true });

  copyDirSync(templateDir, mainWorkspaceDir);
  fs.writeFileSync(path.join(mainWorkspaceDir, "agent_type"), `${selectedTemplate}\n`);

  writeSkillsJson();
  copySkillsTree();
  ensureMainAuthProfiles(process.env);

  const existingConfig = loadJson(openclawConfigPath);
  const nextConfig = mergeOpenclawConfig(existingConfig, process.env, selectedTemplate);
  fs.writeFileSync(openclawConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`);

  console.log(`[openclaw:init] template: ${selectedTemplate}`);
  console.log(`[openclaw:init] agent-workplace: ${agentWorkplaceDir}`);
  console.log(`[openclaw:init] workspace (main): ${mainWorkspaceDir}`);
  console.log(`[openclaw:init] skills copy: ${workspaceSkillsDir}`);
  console.log(`[openclaw:init] config: ${openclawConfigPath}`);
  printAuthSetupReminder();
}

main().catch((error) => {
  console.error(`[openclaw:init] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
