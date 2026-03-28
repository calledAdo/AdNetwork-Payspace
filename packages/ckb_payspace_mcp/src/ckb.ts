// CKB RPC + Indexer client — backed by @ckb-ccc/core.
// All amounts are in shannons (bigint).
// Exported types stay snake_case for backward-compat with routes and builder.

import { ccc } from "@ckb-ccc/core";
import { ckbPayspaceMcpConfig } from "./config.js";

// ── Singleton client (CKB testnet — KnownScript metadata matches this network) ─

const RPC_URL = ckbPayspaceMcpConfig.ckbRpcUrl;
export const client = new ccc.ClientPublicTestnet({ url: RPC_URL });

/** Resolved xUDT script metadata from CCC KnownScript (not stored in .env). */
export type XudtKnownScriptResolved = {
  codeHash: string;
  cellDep: {
    out_point: { tx_hash: string; index: string };
    dep_type: string;
  };
};

let xudtKnownScriptCache: XudtKnownScriptResolved | null = null;

/**
 * Fetch and cache xUDT code hash + cell dep from the node's known-script registry.
 * Testnet-only: uses ClientPublicTestnet.
 */
export async function ensureXudtKnownScriptLoaded(): Promise<XudtKnownScriptResolved> {
  if (xudtKnownScriptCache) return xudtKnownScriptCache;
  const info = await client.getKnownScript(ccc.KnownScript.XUdt);
  const first = info.cellDeps[0];
  if (!first) throw new Error("XUdt known script has no cell deps");
  const op = first.cellDep.outPoint;
  const idxHex = "0x" + Number(op.index).toString(16);
  const depType =
    first.cellDep.depType === "depGroup" ? "dep_group" : "code";
  xudtKnownScriptCache = {
    codeHash: info.codeHash,
    cellDep: {
      out_point: { tx_hash: op.txHash, index: idxHex },
      dep_type: depType,
    },
  };
  return xudtKnownScriptCache;
}

// ── Public types (snake_case — matches CKB RPC JSON format) ──────────────────

export interface Script {
  code_hash: string;
  hash_type: string;
  args: string;
}

export interface OutPoint {
  tx_hash: string;
  index: string; // hex string e.g. "0x0"
}

export interface CellOutput {
  capacity: string; // hex shannons
  lock: Script;
  type: Script | null;
}

export interface LiveCell {
  output: CellOutput;
  output_data: string;
  out_point: OutPoint;
  block_number: string;
}

export interface GetCellsResult {
  objects: LiveCell[];
  last_cursor: string;
}

export interface CkbTransaction {
  transaction: {
    inputs: Array<{ previous_output: OutPoint }>;
    outputs: Array<{ capacity: string; lock: Script; type: Script | null }>;
    outputs_data: string[];
  };
  tx_status: { status: string };
}

// ── Type conversions ──────────────────────────────────────────────────────────

function toCccScript(s: Script): ccc.Script {
  return ccc.Script.from({
    codeHash: s.code_hash,
    hashType: s.hash_type,
    args: s.args,
  });
}

function fromCccScript(s: ccc.Script): Script {
  return {
    code_hash: s.codeHash,
    hash_type: s.hashType,
    args: s.args,
  };
}

function fromCccCell(cell: ccc.Cell): LiveCell {
  const op = cell.outPoint;
  return {
    output: {
      capacity: "0x" + cell.cellOutput.capacity.toString(16),
      lock: fromCccScript(cell.cellOutput.lock),
      type: cell.cellOutput.type ? fromCccScript(cell.cellOutput.type) : null,
    },
    output_data: cell.outputData,
    out_point: {
      tx_hash: op.txHash,
      index: "0x" + Number(op.index).toString(16),
    },
    block_number: "0x0",
  };
}

// ── Exported helpers ──────────────────────────────────────────────────────────

export function parseHexU64(hex: string): bigint {
  return BigInt(hex);
}

export const SECP256K1_CODE_HASH = ckbPayspaceMcpConfig.secp256k1CodeHash;

// ── RPC wrappers ──────────────────────────────────────────────────────────────

export async function getTipBlockNumber(): Promise<bigint> {
  const header = await client.getTipHeader();
  return header.number;
}

export async function getTipHeader(): Promise<{ hash: string; timestamp: bigint }> {
  const header = await client.getTipHeader();
  // CCC returns timestamp in ms as a bigint
  return { hash: header.hash, timestamp: header.timestamp };
}

/**
 * Collect up to `limit` live cells matching the given script.
 * Returns them in the same shape as the old get_cells indexer RPC.
 */
export async function getCellsByScript(
  script: Script,
  scriptType: "lock" | "type",
  limit = 100,
  cursor?: string,
): Promise<GetCellsResult> {
  const searchKey: ccc.ClientIndexerSearchKeyLike = {
    script: toCccScript(script),
    scriptType,
    scriptSearchMode: "prefix",
    withData: true,
  };
  const res = await client.findCellsPaged(searchKey, "asc", limit, cursor);
  return {
    objects: res.cells.map(fromCccCell),
    last_cursor: res.lastCursor,
  };
}

export async function getLiveCell(
  outPoint: OutPoint,
  _withData = true,
): Promise<LiveCell | null> {
  const cell = await client.getCellLive(
    ccc.OutPoint.from({ txHash: outPoint.tx_hash, index: BigInt(outPoint.index) }),
    true,
  );
  if (!cell) return null;
  return fromCccCell(cell);
}

export async function getTransaction(txHash: string): Promise<CkbTransaction> {
  const res = await client.getTransaction(txHash);
  if (!res) throw new Error(`transaction not found: ${txHash}`);
  const tx = res.transaction;
  if (!tx) throw new Error(`transaction not found: ${txHash}`);
  return {
    transaction: {
      inputs: tx.inputs.map((inp) => ({
        previous_output: {
          tx_hash: inp.previousOutput.txHash,
          index: "0x" + Number(inp.previousOutput.index).toString(16),
        },
      })),
      outputs: tx.outputs.map((out) => ({
        capacity: "0x" + out.capacity.toString(16),
        lock: fromCccScript(out.lock),
        type: out.type ? fromCccScript(out.type) : null,
      })),
      outputs_data: tx.outputsData,
    },
    tx_status: { status: res.status },
  };
}

export async function sendTransaction(tx: object): Promise<string> {
  // tx is already a signed CKB RPC snake_case object — submit via raw JSON-RPC
  // to avoid a round-trip through CCC's object model.
  const url = RPC_URL.replace(/\/$/, "") + (RPC_URL.endsWith("rpc") ? "" : "/rpc");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "send_transaction",
      params: [tx, "passthrough"],
    }),
  });
  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(`send_transaction: ${json.error.message}`);
  return json.result!;
}

/**
 * Fetch the current median fee rate from the node in shannons per 1000 bytes.
 * Falls back to 1000 (1 shannon/byte) if the node doesn't support the RPC.
 */
export async function getFeeRateShannonsPerKb(): Promise<bigint> {
  try {
    const rate = await client.getFeeRate();
    return rate > 1000n ? rate : 1000n;
  } catch {
    return 1000n;
  }
}

export async function getBalanceByLock(lockArgs: string): Promise<bigint> {
  const lock = toCccScript({ code_hash: SECP256K1_CODE_HASH, hash_type: "type", args: lockArgs });
  let total = 0n;
  for await (const cell of client.findCellsByLock(lock, null, false)) {
    total += cell.cellOutput.capacity;
  }
  return total;
}

export async function getFuelCellsByLock(
  lockArgs: string,
  limit = 500,
): Promise<LiveCell[]> {
  const lock = toCccScript({
    code_hash: SECP256K1_CODE_HASH,
    hash_type: "type",
    args: lockArgs,
  });

  const cells: LiveCell[] = [];
  for await (const cell of client.findCellsByLock(lock, null, true)) {
    if (cell.cellOutput.type) continue;
    if (cell.outputData && cell.outputData !== "0x") continue;
    cells.push(fromCccCell(cell));
    if (cells.length >= limit) break;
  }
  return cells;
}

export async function getFuelBalanceByLock(
  lockArgs: string,
  limit = 500,
): Promise<{ capacity: bigint; cell_count: number; cells: LiveCell[] }> {
  const cells = await getFuelCellsByLock(lockArgs, limit);
  let capacity = 0n;
  for (const cell of cells) {
    capacity += BigInt(cell.output.capacity);
  }
  return { capacity, cell_count: cells.length, cells };
}
