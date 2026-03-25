// Cell query routes — search live cells and check individual cell liveness.
//
// All indexer queries go through the CKB Indexer get_cells RPC.
// Script hash queries (lock_hash / type_hash) are computed locally from the
// provided script components using the same Blake2b + Molecule pipeline used
// by the builder, then compared against indexed results.

import { ccc } from "@ckb-ccc/core";
import { Router, type Request, type Response } from "express";
import {
  getCellsByScript,
  getFuelBalanceByLock,
  getLiveCell,
  type Script,
} from "../ckb.js";

const router = Router();

// ─── helpers ──────────────────────────────────────────────────────────────────

function scriptHash(script: Script): string {
  return ccc.Script.from({
    codeHash: script.code_hash,
    hashType: script.hash_type,
    args: script.args,
  }).hash();
}

function handleError(res: Response, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  res.status(400).json({ error: message });
}

function parseLimit(raw: unknown): number {
  const n = Number(raw);
  if (!raw || isNaN(n) || n < 1) return 50;
  return Math.min(n, 500);
}

// ─── GET /cells/by-lock ───────────────────────────────────────────────────────
// Query live cells by full lock script.
// Query params: code_hash, hash_type, args, limit?
router.get("/by-lock", async (req: Request, res: Response) => {
  try {
    const { code_hash, hash_type = "type", args = "0x" } = req.query as Record<string, string>;
    if (!code_hash) {
      res.status(400).json({ error: "code_hash is required" });
      return;
    }
    const script: Script = { code_hash, hash_type, args };
    const result = await getCellsByScript(script, "lock", parseLimit(req.query.limit));
    res.json({
      script_hash: scriptHash(script),
      total: result.objects.length,
      cells: result.objects,
      last_cursor: result.last_cursor,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── GET /cells/by-type ───────────────────────────────────────────────────────
// Query live cells by full type script.
// Query params: code_hash, hash_type, args, limit?
router.get("/by-type", async (req: Request, res: Response) => {
  try {
    const { code_hash, hash_type = "type", args = "0x" } = req.query as Record<string, string>;
    if (!code_hash) {
      res.status(400).json({ error: "code_hash is required" });
      return;
    }
    const script: Script = { code_hash, hash_type, args };
    const result = await getCellsByScript(script, "type", parseLimit(req.query.limit));
    res.json({
      script_hash: scriptHash(script),
      total: result.objects.length,
      cells: result.objects,
      last_cursor: result.last_cursor,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── GET /cells/by-lock-code-hash ────────────────────────────────────────────
// Query cells matching any lock that uses a given code_hash (all args).
// Useful when you know the script type but not the specific args.
// Query params: code_hash, hash_type?, limit?
router.get("/by-lock-code-hash", async (req: Request, res: Response) => {
  try {
    const { code_hash, hash_type = "type" } = req.query as Record<string, string>;
    if (!code_hash) {
      res.status(400).json({ error: "code_hash is required" });
      return;
    }
    // args = "0x" with prefix search returns all cells using this code_hash.
    const script: Script = { code_hash, hash_type, args: "0x" };
    const result = await getCellsByScript(script, "lock", parseLimit(req.query.limit));
    res.json({
      code_hash,
      hash_type,
      total: result.objects.length,
      cells: result.objects,
      last_cursor: result.last_cursor,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── GET /cells/by-type-code-hash ────────────────────────────────────────────
// Query cells matching any type script with a given code_hash (all args).
// Query params: code_hash, hash_type?, limit?
router.get("/by-type-code-hash", async (req: Request, res: Response) => {
  try {
    const { code_hash, hash_type = "type" } = req.query as Record<string, string>;
    if (!code_hash) {
      res.status(400).json({ error: "code_hash is required" });
      return;
    }
    // args: "0x" = empty prefix → prefix search matches all cells with this code_hash regardless of args
    const script: Script = { code_hash, hash_type, args: "0x" };
    const result = await getCellsByScript(script, "type", parseLimit(req.query.limit));
    res.json({
      code_hash,
      hash_type,
      total: result.objects.length,
      cells: result.objects,
      last_cursor: result.last_cursor,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /cells/by-lock-hash ─────────────────────────────────────────────────
// Given a full script object, compute its script hash and query for cells.
// Useful when the caller only knows the hash and provides the preimage.
// Body: { code_hash, hash_type, args, limit? }
router.post("/by-lock-hash", async (req: Request, res: Response) => {
  try {
    const { code_hash, hash_type = "type", args = "0x", limit } = req.body as {
      code_hash: string;
      hash_type?: string;
      args?: string;
      limit?: number;
    };
    if (!code_hash) {
      res.status(400).json({ error: "code_hash is required" });
      return;
    }
    const script: Script = { code_hash, hash_type, args };
    const computed_hash = scriptHash(script);
    const result = await getCellsByScript(script, "lock", parseLimit(limit));
    res.json({
      computed_lock_hash: computed_hash,
      total: result.objects.length,
      cells: result.objects,
      last_cursor: result.last_cursor,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /cells/by-type-hash ─────────────────────────────────────────────────
// Same as above but for type scripts.
// Body: { code_hash, hash_type, args, limit? }
router.post("/by-type-hash", async (req: Request, res: Response) => {
  try {
    const { code_hash, hash_type = "type", args = "0x", limit } = req.body as {
      code_hash: string;
      hash_type?: string;
      args?: string;
      limit?: number;
    };
    if (!code_hash) {
      res.status(400).json({ error: "code_hash is required" });
      return;
    }
    const script: Script = { code_hash, hash_type, args };
    const computed_hash = scriptHash(script);
    const result = await getCellsByScript(script, "type", parseLimit(limit));
    res.json({
      computed_type_hash: computed_hash,
      total: result.objects.length,
      cells: result.objects,
      last_cursor: result.last_cursor,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── GET /cells/live ──────────────────────────────────────────────────────────
// Check the liveness of a specific cell by outpoint.
// Query params: tx_hash, index
router.get("/live", async (req: Request, res: Response) => {
  try {
    const { tx_hash, index } = req.query as Record<string, string>;
    if (!tx_hash || index === undefined) {
      res.status(400).json({ error: "tx_hash and index are required" });
      return;
    }
    const hexIndex = index.startsWith("0x") ? index : "0x" + Number(index).toString(16);
    const cell = await getLiveCell({ tx_hash, index: hexIndex }, true);
    if (!cell) {
      res.json({ live: false, cell: null });
      return;
    }
    res.json({
      live: true,
      cell,
      lock_hash: cell.output.lock ? scriptHash(cell.output.lock) : null,
      type_hash: cell.output.type ? scriptHash(cell.output.type) : null,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /cells/compute-script-hash ─────────────────────────────────────────
// Pure utility: compute the script hash for a given script object.
// Body: { code_hash, hash_type, args }
router.post("/compute-script-hash", (req: Request, res: Response) => {
  try {
    const { code_hash, hash_type = "type", args = "0x" } = req.body as {
      code_hash: string;
      hash_type?: string;
      args?: string;
    };
    if (!code_hash) {
      res.status(400).json({ error: "code_hash is required" });
      return;
    }
    const script: Script = { code_hash, hash_type, args };
    res.json({ script, script_hash: scriptHash(script) });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── GET /cells/fuel ─────────────────────────────────────────────────────────
// Query spendable plain secp256k1 cells owned by a lock. These are the cells
// that can act as "fuel" for fees and plain-capacity funding.
// Query params: lock_args, limit?
router.get("/fuel", async (req: Request, res: Response) => {
  try {
    const { lock_args } = req.query as Record<string, string>;
    if (!lock_args) {
      res.status(400).json({ error: "lock_args is required" });
      return;
    }

    const limit = parseLimit(req.query.limit);
    const result = await getFuelBalanceByLock(lock_args, limit);
    res.json({
      lock_args,
      cell_count: result.cell_count,
      usable_capacity_shannons: result.capacity.toString(),
      usable_capacity_ckb:
        (Number(result.capacity) / 1e8).toString(),
      definition: {
        type: null,
        output_data: "0x",
      },
      cells: result.cells,
    });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
