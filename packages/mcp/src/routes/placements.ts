// BookingSpace cell routes — publish, book, release, and list ad slots on CKB.
//
// POST /placements/build/publish     — seller creates a new booking-space cell
// POST /placements/build/book        — seller confirms booking (after buyer opens channel)
// POST /placements/build/cancel      — seller releases slot back to available
// GET  /placements                   — list live booking-space cells (with filters)
// GET  /placements/:tx_hash/:index   — get a single cell + decoded data

import { Router, type Request, type Response } from "express";
import blake2b from "blake2b";
import { getCellsByScript, getLiveCell } from "../ckb.js";
import {
  AD_POSITION,
  PUBLICATION_MODE,
  attachFuelPreflight,
  buildPublishPlacement,
  buildBookPlacement,
  buildCancelBooking,
  applyFeeTank,
  hexToBuffer,
  injectSignature,
} from "../builder.js";
import {
  assertHexByteLength,
  formatPlacementCell,
  formatPlacementId,
  matchesKeywordFlags,
  normalizePlacementIndex,
  parseAdPositionInput,
  parseBooleanInput,
  parsePublicationModeInput,
} from "../booking_space.js";
import { sendTransaction } from "../ckb.js";

// ── IPFS helpers ──────────────────────────────────────────────────────────────

const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs",
  "https://cloudflare-ipfs.com/ipfs",
  "https://dweb.link/ipfs",
];

const CID_TEXT_PATTERN = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/;

async function fetchFromIpfs(cid: string): Promise<string> {
  for (const gateway of IPFS_GATEWAYS) {
    try {
      const res = await fetch(`${gateway}/${cid}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return await res.text();
    } catch {
      // try next gateway
    }
  }
  throw new Error(`IPFS fetch failed for CID ${cid} on all gateways`);
}

function resolveContractDetailsCid(raw: string): string | null {
  const direct = raw.trim();
  if (CID_TEXT_PATTERN.test(direct)) return direct;

  try {
    const ascii = hexToBuffer(raw).toString("utf8").replace(/\0+$/g, "").trim();
    return CID_TEXT_PATTERN.test(ascii) ? ascii : null;
  } catch {
    return null;
  }
}

function ckbHash(data: Buffer): string {
  const personal = Buffer.alloc(16);
  personal.write("ckb-default-hash");
  const h = blake2b(32, undefined, undefined, personal);
  h.update(data);
  return "0x" + Buffer.from(h.digest()).toString("hex");
}

const BOOKING_SPACE_TYPE_CODE_HASH = process.env.BOOKING_SPACE_TYPE_CODE_HASH ?? "";
const BOOKING_SPACE_TYPE_HASH_TYPE = process.env.BOOKING_SPACE_TYPE_HASH_TYPE ?? "type";
const router = Router();

function handleError(res: Response, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  res.status(400).json({ error: message });
}

async function finalizeBuild(
  result: Awaited<ReturnType<typeof buildPublishPlacement>>,
  feePayerLockArgs: string | undefined,
  implicitPayerLockArgs: string,
) {
  const built = await applyFeeTank(result, feePayerLockArgs);
  return feePayerLockArgs
    ? built
    : await attachFuelPreflight(built, implicitPayerLockArgs);
}

// ─── GET /placements ──────────────────────────────────────────────────────────
// Query: status? (0=available|1=taken), ad_position?, limit?
router.get("/", async (req: Request, res: Response) => {
  try {
    if (!BOOKING_SPACE_TYPE_CODE_HASH) {
      res.status(503).json({ error: "BOOKING_SPACE_TYPE_CODE_HASH not configured" });
      return;
    }
    const { status, ad_position, keyword_flags, max_price, limit } =
      req.query as Record<string, string>;
    const lim = Math.min(Number(limit) || 50, 500);

    const script = {
      code_hash: BOOKING_SPACE_TYPE_CODE_HASH,
      hash_type: BOOKING_SPACE_TYPE_HASH_TYPE,
      args: "0x",
    };

    const result = await getCellsByScript(script, "type", lim);

    const slots = result.objects
      .map((cell) => {
        if (!cell.output_data || cell.output_data === "0x") return null;
        try {
          return formatPlacementCell(cell);
        } catch {
          return null;
        }
      })
      .filter((cell): cell is NonNullable<typeof cell> => cell !== null)
      .filter((cell) => {
        if (status !== undefined && cell.booking_space.status !== Number(status)) return false;
        if (ad_position !== undefined && cell.booking_space.ad_position !== Number(ad_position)) return false;
        if (!matchesKeywordFlags(BigInt(cell.booking_space.keyword_flags), keyword_flags)) return false;
        if (max_price !== undefined && BigInt(cell.booking_space.price_per_mille) > BigInt(max_price)) return false;
        return true;
      });

    res.json({ total: slots.length, placements: slots, last_cursor: result.last_cursor });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── GET /placements/:tx_hash/:index/details ─────────────────────────────────
// Fetch IPFS-hosted placement details, verify blake2b hash against on-chain cell.
// Returns verified JSON blob: { placement_id, details, ipfs_cid, verified: true }
// If cell has no IPFS data: 404 with the canonical placement_id so callers can
// fall back to PAYSPACE_API_URL/placements/details/{placement_id}.
router.get("/:tx_hash/:index/details", async (req: Request, res: Response) => {
  try {
    const tx_hash = String(req.params.tx_hash);
    const indexStr = String(req.params.index);
    const { index_hex: hexIndex, index_number: indexNumber } = normalizePlacementIndex(indexStr);

    const cell = await getLiveCell({ tx_hash, index: hexIndex }, true);
    if (!cell) {
      res.status(404).json({ error: "cell not found or not live" });
      return;
    }
    if (!cell.output_data || cell.output_data === "0x") {
      res.status(400).json({ error: "cell has no data — not a booking-space cell" });
      return;
    }

    const placement = formatPlacementCell({
      out_point: { tx_hash, index: hexIndex },
      output: cell.output,
      output_data: cell.output_data,
      block_number: cell.block_number,
    });

    if (!placement.booking_space.ipfs_present || !placement.booking_space.details_cid) {
      res.status(404).json({
        error: "no IPFS details in cell",
        placement_id: placement.placement_id,
        gateway_url: placement.booking_space.gateway_url ?? null,
        fallback: "fetch placement details from PAYSPACE_API_URL/placements/details/{placement_id}",
      });
      return;
    }

    const resolvedCid = resolveContractDetailsCid(placement.booking_space.details_cid);
    if (!resolvedCid) {
      res.status(422).json({
        error: "details_cid stored in BookingSpace is not a directly fetchable CID string",
        details_cid: placement.booking_space.details_cid,
        note: "The contract currently stores a 32-byte details reference. This MCP route can only fetch IPFS content when that reference can be resolved to a CID string.",
      });
      return;
    }

    const content = await fetchFromIpfs(resolvedCid);

    if (placement.booking_space.details_hash) {
      const actual = ckbHash(Buffer.from(content));
      if (actual !== placement.booking_space.details_hash) {
        res.status(422).json({
          error: "IPFS content hash mismatch — data may be tampered",
          expected: placement.booking_space.details_hash,
          actual,
        });
        return;
      }
    }

    let details: unknown;
    try {
      details = JSON.parse(content);
    } catch {
      res.status(422).json({ error: "IPFS content is not valid JSON" });
      return;
    }

    res.json({
      placement_id: formatPlacementId(tx_hash, indexNumber),
      placement_tx_hash: tx_hash,
      placement_index: indexNumber,
      ipfs_cid: resolvedCid,
      details_hash: placement.booking_space.details_hash,
      verified: !!placement.booking_space.details_hash,
      details,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── GET /placements/:tx_hash/:index ─────────────────────────────────────────
router.get("/:tx_hash/:index", async (req: Request, res: Response) => {
  try {
    const tx_hash = String(req.params.tx_hash);
    const indexStr = String(req.params.index);
    const { index_hex: hexIndex } = normalizePlacementIndex(indexStr);
    const cell = await getLiveCell({ tx_hash, index: hexIndex }, true);
    if (!cell) {
      res.status(404).json({ error: "cell not found or not live" });
      return;
    }
    if (!cell.output_data || cell.output_data === "0x") {
      res.status(400).json({ error: "cell has no data — not a booking-space cell" });
      return;
    }
    res.json(formatPlacementCell({
      out_point: { tx_hash, index: hexIndex },
      output: cell.output,
      output_data: cell.output_data,
      block_number: cell.block_number,
    }));
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /placements/build/publish ──────────────────────────────────────────
// Seller creates a new BookingSpace cell (status=available).
// Body: { seller_lock_args, seller_pubkey, price_per_mille,
//         ad_position, publication_mode, keyword_flags,
//         ipfs_present?, details_cid?, details_hash?, gateway_url?,
//         fee_payer_lock_args? }
router.post("/build/publish", async (req: Request, res: Response) => {
  try {
    const {
      seller_lock_args,
      seller_pubkey,
      price_per_mille,
      ad_position,
      publication_mode: rawPublicationMode,
      keyword_flags,
      ipfs_present: rawIpfsPresent,
      details_cid,
      details_hash,
      gateway_url,
      fee_payer_lock_args,
    } = req.body as {
      seller_lock_args: string;
      seller_pubkey: string;
      price_per_mille: string | number;
      ad_position: string | number;
      publication_mode: string | number;
      keyword_flags: string | number;
      ipfs_present?: boolean | string | number;
      details_cid?: string;
      details_hash?: string;
      gateway_url?: string;
      fee_payer_lock_args?: string;
    };

    if (!seller_lock_args || !seller_pubkey || !price_per_mille ||
        ad_position === undefined || rawPublicationMode === undefined || !keyword_flags) {
      res.status(400).json({
        error: "seller_lock_args, seller_pubkey, price_per_mille, ad_position, publication_mode, and keyword_flags are required",
      });
      return;
    }

    assertHexByteLength(seller_lock_args, 20, "seller_lock_args");
    assertHexByteLength(seller_pubkey, 33, "seller_pubkey");

    const pricePerMille = BigInt(price_per_mille);
    const keywordFlags = BigInt(keyword_flags);
    const adPosition = parseAdPositionInput(ad_position);
    const publicationMode = parsePublicationModeInput(rawPublicationMode);
    const ipfsPresent = parseBooleanInput(rawIpfsPresent);

    if (adPosition === null) {
      res.status(400).json({
        error: `ad_position must be one of ${AD_POSITION.banner}, ${AD_POSITION.sidebar}, ${AD_POSITION.native}, ${AD_POSITION.interstitial} or a matching label`,
      });
      return;
    }

    if (publicationMode === null) {
      res.status(400).json({
        error: `publication_mode must be one of ${PUBLICATION_MODE.MANUAL}, ${PUBLICATION_MODE.SNIPPET_MANAGED}, MANUAL, or SNIPPET_MANAGED`,
      });
      return;
    }

    if (pricePerMille < 0n) {
      res.status(400).json({ error: "price_per_mille must be non-negative" });
      return;
    }

    if (keywordFlags < 0n) {
      res.status(400).json({ error: "keyword_flags must be non-negative" });
      return;
    }

    if (gateway_url && Buffer.byteLength(gateway_url, "utf8") > 255) {
      res.status(400).json({ error: "gateway_url exceeds 255-byte BookingSpace limit" });
      return;
    }

    if (details_cid) {
      assertHexByteLength(details_cid, 32, "details_cid");
    }
    if (details_hash) {
      assertHexByteLength(details_hash, 32, "details_hash");
    }

    if (ipfsPresent && !details_cid) {
      res.status(400).json({
        error: "details_cid is required when ipfs_present is true",
      });
      return;
    }

    if (publicationMode === PUBLICATION_MODE.SNIPPET_MANAGED && !gateway_url) {
      res.status(400).json({
        error: "gateway_url is required when publication_mode is SNIPPET_MANAGED",
      });
      return;
    }

    const result = await buildPublishPlacement(seller_lock_args, {
      seller_pubkey,
      price_per_mille: pricePerMille.toString(),
      ad_position: adPosition,
      publication_mode: publicationMode,
      keyword_flags: keywordFlags.toString(),
      ipfs_present: ipfsPresent,
      details_cid,
      details_hash,
      gateway_url,
    });
    res.json(await finalizeBuild(result, fee_payer_lock_args, seller_lock_args));
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /placements/build/book ─────────────────────────────────────────────
// Seller confirms a booking after the buyer opened a payment channel.
// Body: { seller_lock_args, placement_tx_hash, placement_index, channel_tx_hash, [fee_payer_lock_args] }
router.post("/build/book", async (req: Request, res: Response) => {
  try {
    const { seller_lock_args, placement_tx_hash, placement_index, channel_tx_hash, fee_payer_lock_args } =
      req.body as {
        seller_lock_args: string;
        placement_tx_hash: string;
        placement_index: number;
        channel_tx_hash: string;
        fee_payer_lock_args?: string;
      };

    if (!seller_lock_args || !placement_tx_hash || placement_index === undefined || !channel_tx_hash) {
      res.status(400).json({
        error: "seller_lock_args, placement_tx_hash, placement_index, and channel_tx_hash are required",
      });
      return;
    }

    const result = await buildBookPlacement(seller_lock_args, {
      placement_tx_hash,
      placement_index,
      channel_tx_hash,
    });
    res.json(await finalizeBuild(result, fee_payer_lock_args, seller_lock_args));
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /placements/build/cancel ───────────────────────────────────────────
// Seller releases a slot back to available after a channel closes.
// Body: { seller_lock_args, placement_tx_hash, placement_index, [fee_payer_lock_args] }
router.post("/build/cancel", async (req: Request, res: Response) => {
  try {
    const { seller_lock_args, placement_tx_hash, placement_index, fee_payer_lock_args } = req.body as {
      seller_lock_args: string;
      placement_tx_hash: string;
      placement_index: number;
      fee_payer_lock_args?: string;
    };

    if (!seller_lock_args || !placement_tx_hash || placement_index === undefined) {
      res.status(400).json({
        error: "seller_lock_args, placement_tx_hash, and placement_index are required",
      });
      return;
    }

    const result = await buildCancelBooking(seller_lock_args, {
      placement_tx_hash,
      placement_index,
    });
    res.json(await finalizeBuild(result, fee_payer_lock_args, seller_lock_args));
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /placements/submit ──────────────────────────────────────────────────
// Inject signature and broadcast a signed placement tx.
// Body: { tx, signature }
router.post("/submit", async (req: Request, res: Response) => {
  try {
    const { tx, signature } = req.body as { tx: object; signature: string };
    const signed = injectSignature(
      tx as Parameters<typeof injectSignature>[0],
      signature
    );
    const txHash = await sendTransaction(signed);
    res.json({ tx_hash: txHash });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
