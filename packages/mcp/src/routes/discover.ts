// Discovery routes — marketplace manifest and on-chain placement search.
//
// GET  /discover                — full marketplace manifest
// GET  /discover/placements     — available slots (filters: keyword_flags, max_price, ad_position, limit)

import { Router, type Request, type Response } from "express";
import { getCellsByScript } from "../ckb.js";
import { formatPlacementCell, matchesKeywordFlags } from "../booking_space.js";

const router = Router();

const MCP_URL = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
const BOOKING_SPACE_TYPE_CODE_HASH = process.env.BOOKING_SPACE_TYPE_CODE_HASH ?? "";
const BOOKING_SPACE_TYPE_HASH_TYPE = process.env.BOOKING_SPACE_TYPE_HASH_TYPE ?? "type";

// ─── GET /discover ────────────────────────────────────────────────────────────
router.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "PaySpace Ad Network MCP",
    version: "0.1.0",
    description:
      "Stateless ad marketplace tool library. Builds transactions, queries the chain, " +
      "and decodes booking-space cells. No persistent state.",
    base_url: MCP_URL,
    endpoints: {
      placements: {
        "GET /placements": "List live booking-space cells (filter: status, ad_position, keyword_flags, max_price, limit)",
        "GET /placements/:tx_hash/:index": "Get a single booking-space cell with decoded data",
        "GET /placements/:tx_hash/:index/details": "Fetch IPFS-hosted placement details; verifies blake2b hash against on-chain cell. Returns { placement_id, ipfs_cid, verified, details }. 404 if no IPFS data.",
        "POST /placements/build/publish": "Build tx: seller deploys a new ad slot",
        "POST /placements/build/book": "Build tx: seller confirms booking (after buyer opens channel)",
        "POST /placements/build/cancel": "Build tx: seller releases slot back to available",
        "POST /placements/submit": "Inject signature and broadcast",
      },
      payment_channel: {
        "POST /transactions/build/transfer":
          "Build tx: send plain CKB (fuel) to another lock",
        "POST /transactions/build/xudt-transfer":
          "Build tx: send the configured xUDT token to another lock",
        "POST /transactions/build/settlement":
          "Build tx: buyer opens payment channel (deposits UDT)",
        "POST /transactions/build/dispute":
          "Build tx: initiate or update dispute with latest buyer-signed ticket",
        "POST /transactions/build/coop-close":
          "Build tx: cooperative close with agreed split (returns coop_signing_message)",
        "POST /transactions/build/payout":
          "Build tx: final payout after 24-hour dispute window expires",
        "POST /transactions/submit": "Inject signature and broadcast",
      },
      cells: {
        "GET /cells/by-lock": "Query cells by full lock script",
        "GET /cells/by-type": "Query cells by full type script",
        "GET /cells/by-type-code-hash": "Query all cells of a type (any args)",
        "GET /cells/live": "Check liveness of a specific outpoint",
        "GET /cells/fuel": "Query spendable plain secp256k1 cells usable as fuel and summarize capacity",
      },
      discovery: {
        "GET /discover": "This manifest",
        "GET /discover/placements": "Available (unbooked) placement slots — stateless on-chain scan",
      },
    },
    notes: {
      tracking: "Impression/click tracking is NOT provided by this server. Payspace users: use TRACKING_URL (track.payspace.io). External agents: bring your own.",
      placement_details: "IPFS details are fetched and hash-verified at GET /placements/:tx_hash/:index/details (chain as root of trust). For cells without IPFS data, Payspace users should fetch PAYSPACE_API_URL/placements/details/{tx_hash}:{index}.",
      placement_id: "Canonical placement identifier is the cell outpoint: tx_hash:index",
      fuel: "Build responses include a `fuel` block for the effective fee payer, showing current spendable plain-cell capacity, estimated fee, required fuel reserve, projected change, and sufficiency.",
    },
    env_vars: {
      BOOKING_SPACE_TYPE_CODE_HASH: "Type script code hash for booking-space cells",
      BOOKING_SPACE_TYPE_DEP_TX_HASH: "Dep cell containing booking-space type script binary",
      SETTLEMENT_LOCK_CODE_HASH: "Payment channel lockscript code hash",
      SETTLEMENT_LOCK_DEP_TX_HASH: "Dep cell containing settlement lock binary",
      CKB_RPC_URL: "CKB node RPC (default: testnet)",
      CKB_INDEXER_URL: "CKB indexer RPC (default: testnet)",
      PUBLIC_BASE_URL: "This server's public base URL",
      DEFAULT_XUDT_TYPE_ARGS: "Optional default xUDT type args used by /transactions/build/xudt-transfer when udt_type_args is omitted",
    },
  });
});

// ─── GET /discover/placements ─────────────────────────────────────────────────
// Stateless on-chain scan for available slots.
// Query params:
//   status         — 0=available (default), 1=taken
//   status         — 0=available (default filter), omit to include all
//   keyword_flags  — uint32 bitmask; cell must have all required flags set
//   max_price      — maximum price_per_mille (UDT units)
//   ad_position    — 0=banner, 1=sidebar, 2=native, 3=interstitial
//   limit          — max results (default 100, max 500)
router.get("/placements", async (req: Request, res: Response) => {
  try {
    if (!BOOKING_SPACE_TYPE_CODE_HASH) {
      res.status(503).json({ error: "BOOKING_SPACE_TYPE_CODE_HASH not configured" });
      return;
    }

    const { status = "0", ad_position, keyword_flags, max_price, limit } =
      req.query as Record<string, string>;
    const lim = Math.min(Number(limit) || 100, 500);
    const requestedStatus = Number(status);

    if (!Number.isInteger(requestedStatus) || (requestedStatus !== 0 && requestedStatus !== 1)) {
      res.status(400).json({ error: "status must be 0 or 1" });
      return;
    }

    const result = await getCellsByScript(
      { code_hash: BOOKING_SPACE_TYPE_CODE_HASH, hash_type: BOOKING_SPACE_TYPE_HASH_TYPE, args: "0x" },
      "type",
      lim
    );

    const placements = result.objects
      .map((cell) => {
        if (!cell.output_data || cell.output_data === "0x") return null;
        try {
          return formatPlacementCell(cell);
        } catch {
          return null;
        }
      })
      .filter((placement): placement is NonNullable<typeof placement> => placement !== null)
      .filter((cell) => {
        if (cell.booking_space.status !== requestedStatus) return false;
        if (ad_position !== undefined && cell.booking_space.ad_position !== Number(ad_position)) return false;
        if (!matchesKeywordFlags(BigInt(cell.booking_space.keyword_flags), keyword_flags)) return false;
        if (max_price !== undefined && BigInt(cell.booking_space.price_per_mille) > BigInt(max_price)) return false;
        return true;
      })
      .map((placement) => ({
        placement_id: placement.placement_id,
        placement_tx_hash: placement.placement_tx_hash,
        placement_index: placement.placement_index,
        out_point: placement.out_point,
        capacity: placement.capacity,
        seller_pubkey: placement.booking_space.seller_pubkey,
        price_per_mille: placement.booking_space.price_per_mille,
        ad_position: placement.booking_space.ad_position,
        publication_mode: placement.booking_space.publication_mode,
        keyword_flags: placement.booking_space.keyword_flags,
        gateway_url: placement.booking_space.gateway_url,
        ipfs_present: placement.booking_space.ipfs_present,
        details_cid: placement.booking_space.details_cid,
        details_hash: placement.booking_space.details_hash,
      }));

    res.setHeader("X-Total-Count", String(placements.length));
    res.setHeader("X-Last-Cursor", result.last_cursor);
    res.json(placements);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

export default router;
