#!/usr/bin/env node
/**
 * Ensures repo-root .env contains DEFAULT_XUDT_TYPE_ARGS (xUDT token instance).
 * If missing, runs testnet xUDT mint (deploy_xudt.mts) and merges into .env.
 * xUDT code hash / dep tx are resolved at MCP runtime via CCC KnownScript — not in .env.
 *
 * Usage:
 *   node scripts/ensure_xudt_env.mjs              # real deploy + merge when needed
 *   node scripts/ensure_xudt_env.mjs --dry-run    # preview only (no .env write, no broadcast)
 *
 * Manual mint only (no .env merge): ./scripts/deploy-xudt
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(rootDir, ".env");
const dryRun = process.argv.includes("--dry-run");
const ckbPkg = path.join(rootDir, "packages", "ckb_payspace_mcp");

const KEYS = ["DEFAULT_XUDT_TYPE_ARGS"];

function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function hasDefaultXudtTypeArgs(parsed) {
  return Boolean(parsed.DEFAULT_XUDT_TYPE_ARGS?.trim());
}

function upsertEnvKeys(text, updates) {
  const lines = text.length ? text.split("\n") : [];
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (m && updates[m[1]] !== undefined) {
      out.push(`${m[1]}=${updates[m[1]]}`);
      seen.add(m[1]);
    } else {
      out.push(line);
    }
  }
  for (const k of KEYS) {
    if (!seen.has(k) && updates[k]) out.push(`${k}=${updates[k]}`);
  }
  let result = out.join("\n");
  if (result && !result.endsWith("\n")) result += "\n";
  return result;
}

function runDeploy(extraArgs) {
  const r = spawnSync(
    "npx",
    ["tsx", "scripts/deploy_xudt.mts", "--machine-json", ...extraArgs],
    {
      cwd: ckbPkg,
      encoding: "utf8",
      env: { ...process.env },
      stdio: ["inherit", "pipe", "pipe"],
    },
  );
  if (r.error) {
    throw r.error;
  }
  const line = (r.stdout || "").trim().split("\n").filter(Boolean).pop();
  if (r.status !== 0) {
    let err = (r.stderr || "").trim() || `exit ${r.status}`;
    try {
      const j = JSON.parse(err.split("\n").pop() || "{}");
      if (j.error) err = j.error;
    } catch {
      /* keep */
    }
    throw new Error(err);
  }
  if (!line) throw new Error("deploy_xudt produced no stdout");
  return JSON.parse(line);
}

function main() {
  let raw = "";
  if (fs.existsSync(envPath)) raw = fs.readFileSync(envPath, "utf8");
  const parsed = parseEnvFile(raw);

  if (hasDefaultXudtTypeArgs(parsed)) {
    console.log(
      JSON.stringify({
        skipped: true,
        reason: "DEFAULT_XUDT_TYPE_ARGS already in .env",
      }),
    );
    return;
  }

  if (!process.env.CKB_PRIVATE_KEY?.trim()) {
    console.error(
      JSON.stringify({
        error:
          "CKB_PRIVATE_KEY required in environment to mint xUDT when DEFAULT_XUDT_TYPE_ARGS is unset",
      }),
    );
    process.exit(1);
  }

  const extra = dryRun ? ["--dry-run"] : [];
  const result = runDeploy(extra);

  if (result.error) {
    console.error(JSON.stringify(result));
    process.exit(1);
  }

  const updates = {
    DEFAULT_XUDT_TYPE_ARGS: result.DEFAULT_XUDT_TYPE_ARGS,
  };

  if (dryRun) {
    console.log(
      JSON.stringify({
        dry_run: true,
        would_merge: updates,
        issuer_address: result.issuer_address,
        tx_hash: result.tx_hash ?? null,
      }),
    );
    return;
  }

  if (!updates.DEFAULT_XUDT_TYPE_ARGS) {
    console.error(JSON.stringify({ error: "deploy response missing DEFAULT_XUDT_TYPE_ARGS" }));
    process.exit(1);
  }

  const next = upsertEnvKeys(raw, updates);
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, next, { mode: 0o600 });
  console.log(
    JSON.stringify({
      merged: true,
      path: envPath,
      tx_hash: result.tx_hash,
      DEFAULT_XUDT_TYPE_ARGS: updates.DEFAULT_XUDT_TYPE_ARGS,
    }),
  );
}

main();
