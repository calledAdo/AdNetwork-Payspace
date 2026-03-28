#!/usr/bin/env npx tsx
/**
 * Issue a minimal xUDT on CKB testnet using CCC KnownScript.XUdt.
 * xUDT script metadata (code hash + cell dep) is not stored in .env — MCP resolves it at runtime.
 *
 * Loads repo-root .env when present (run from repo root or from this package).
 *
 * Usage:
 *   cd packages/ckb_payspace_mcp && npx tsx scripts/deploy_xudt.mts
 *   npx tsx packages/ckb_payspace_mcp/scripts/deploy_xudt.mts [--dry-run] [--yes] [--amount <uint128>]
 *
 * Environment:
 *   CKB_RPC_URL     — default https://testnet.ckb.dev/
 *   CKB_PRIVATE_KEY — issuer key (hex, with or without 0x)
 *   MIN_TESTNET_CKB_FOR_MINT_SHANNONS — optional; abort if live balance below this (default 10e9 shannons = 10 CKB)
 *   ALLOW_MINT_WITHOUT_CONFIRM=1 — skip interactive confirmation (non-TTY also skips)
 *
 * Outputs JSON: DEFAULT_XUDT_TYPE_ARGS for repo-root .env; tx_hash when broadcast (unless --dry-run).
 */
import { parseArgs } from "node:util";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { ccc } from "@ckb-ccc/core";
import { getBalanceByLock } from "../src/ckb.js";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, "../../../.env") });
dotenv.config({ path: path.join(here, "../../.env") });

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "dry-run": { type: "boolean", default: false },
    "machine-json": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    amount: { type: "string" },
  },
});

const machineJson = values["machine-json"];

const DEFAULT_MIN_SHANNONS = 10_000_000_000n; // 10 CKB

function normalizePk(raw: string): string {
  const s = raw.trim();
  return s.startsWith("0x") ? s : `0x${s}`;
}

function shannonsToCkbString(s: bigint): string {
  const whole = s / 100_000_000n;
  const frac = s % 100_000_000n;
  if (frac === 0n) return `${whole}`;
  const f = frac.toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole}.${f}`;
}

async function confirmMint(issuerAddress: string, balanceShannons: bigint): Promise<boolean> {
  if (values.yes || process.env.ALLOW_MINT_WITHOUT_CONFIRM === "1")
    return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return true;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const question = (q: string) =>
    new Promise<string>((resolve) => rl.question(q, resolve));
  try {
    const line = await question(
      `[deploy_xudt] Issuer ${issuerAddress} has ${shannonsToCkbString(balanceShannons)} testnet CKB (live balance). Proceed with mint? [y/N] `,
    );
    const ok = line.trim().toLowerCase() === "y" || line.trim().toLowerCase() === "yes";
    return ok;
  } finally {
    rl.close();
  }
}

async function main() {
  const rpc = process.env.CKB_RPC_URL?.trim() || "https://testnet.ckb.dev/";
  const pkRaw = process.env.CKB_PRIVATE_KEY?.trim();
  if (!pkRaw) {
    console.error(
      JSON.stringify({ error: "CKB_PRIVATE_KEY is required in .env or environment" }),
    );
    process.exit(1);
  }

  const minStr = process.env.MIN_TESTNET_CKB_FOR_MINT_SHANNONS?.trim();
  const minShannons = minStr ? BigInt(minStr) : DEFAULT_MIN_SHANNONS;

  const client = new ccc.ClientPublicTestnet({ url: rpc });
  const signer = new ccc.SignerCkbPrivateKey(client, normalizePk(pkRaw));
  await signer.connect();

  const lockScript = (await signer.getAddressObjSecp256k1()).script;
  const lockArgs = lockScript.args;
  const issuerAddress = await signer.getRecommendedAddress();

  const balanceShannons = await getBalanceByLock(lockArgs);
  const balanceLine = `testnet_ckb_live: ${shannonsToCkbString(balanceShannons)} (${balanceShannons.toString()} shannons)`;

  if (balanceShannons < minShannons) {
    const msg = {
      error: "insufficient_testnet_ckb",
      issuer_address: issuerAddress,
      balance_shannons: balanceShannons.toString(),
      min_shannons: minShannons.toString(),
      hint:
        "Fund this address with testnet CKB (e.g. https://faucet.nervos.org/) then retry. " +
        "Adjust MIN_TESTNET_CKB_FOR_MINT_SHANNONS if needed.",
    };
    if (machineJson) console.error(JSON.stringify(msg));
    else console.error(JSON.stringify(msg, null, 2));
    process.exit(1);
  }

  const xudtArgs = lockScript.hash() + "00000000";
  const typeScript = await ccc.Script.fromKnownScript(
    client,
    ccc.KnownScript.XUdt,
    xudtArgs,
  );

  const defaultXudtTypeArgs = typeScript.args;

  const amountStr = values.amount ?? "1000000000000";
  const amountBn = BigInt(amountStr);
  if (amountBn < 0n) throw new Error("--amount must be non-negative");

  if (values["dry-run"]) {
    const payload = {
      dry_run: true,
      issuer_address: issuerAddress,
      DEFAULT_XUDT_TYPE_ARGS: defaultXudtTypeArgs,
      balance_shannons: balanceShannons.toString(),
      balance_ckb: shannonsToCkbString(balanceShannons),
      hint:
        "xUDT script metadata comes from CCC KnownScript at MCP runtime — only DEFAULT_XUDT_TYPE_ARGS is written to .env. " +
        "setup.sh merges DEFAULT_XUDT_TYPE_ARGS when unset.",
    };
    if (machineJson) console.log(JSON.stringify(payload));
    else console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const ok = await confirmMint(issuerAddress, balanceShannons);
  if (!ok) {
    const msg = { error: "mint_cancelled_by_user", issuer_address: issuerAddress };
    if (machineJson) console.error(JSON.stringify(msg));
    else console.error(JSON.stringify(msg, null, 2));
    process.exit(1);
  }

  if (!machineJson) {
    process.stderr.write(`[deploy_xudt] ${balanceLine}\n`);
  }

  const tx = ccc.Transaction.from({
    outputs: [{ lock: lockScript, type: typeScript }],
    outputsData: [ccc.numLeToBytes(amountBn, 16)],
  });

  await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.XUdt);
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000n);

  const txHash = await signer.sendTransaction(tx);

  const payload = {
    ok: true,
    tx_hash: txHash,
    issuer_address: issuerAddress,
    DEFAULT_XUDT_TYPE_ARGS: defaultXudtTypeArgs,
    env_lines: [`DEFAULT_XUDT_TYPE_ARGS=${defaultXudtTypeArgs}`],
  };
  if (machineJson) console.log(JSON.stringify(payload));
  else console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  const isMachine = process.argv.includes("--machine-json");
  if (isMachine) console.error(JSON.stringify({ error: msg }));
  else console.error(JSON.stringify({ error: msg }, null, 2));
  process.exit(1);
});
