import { Router, type Request, type Response } from "express";
import {
  attachFuelPreflight,
  buildTransfer,
  buildUdtTransfer,
  buildOpenChannel,
  buildDisputeTx,
  buildCoopClose,
  buildFinalPayout,
  applyFeeTank,
  injectSignature,
} from "../builder.js";
import { sendTransaction } from "../ckb.js";

const router = Router();

function handleError(res: Response, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  res.status(400).json({ error: message });
}

async function finalizeBuild(
  result: Awaited<ReturnType<typeof buildTransfer>>,
  feePayerLockArgs: string | undefined,
  implicitPayerLockArgs: string,
) {
  const built = await applyFeeTank(result, feePayerLockArgs);
  return feePayerLockArgs
    ? built
    : await attachFuelPreflight(built, implicitPayerLockArgs);
}

// ─── POST /transactions/build/transfer ───────────────────────────────────────
// Build a plain CKB transfer.
// Body: { from_lock_args, to_lock_args, amount_ckb, [fee_payer_lock_args] }
router.post("/build/transfer", async (req: Request, res: Response) => {
  try {
    const { from_lock_args, to_lock_args, amount_ckb, fee_payer_lock_args } =
      req.body as {
        from_lock_args: string;
        to_lock_args: string;
        amount_ckb: number;
        fee_payer_lock_args?: string;
      };
    const result = await buildTransfer(from_lock_args, { to_lock_args, amount_ckb });
    res.json(await finalizeBuild(result, fee_payer_lock_args, from_lock_args));
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /transactions/build/xudt-transfer ─────────────────────────────────
// Build an xUDT transfer using the hardcoded xUDT code hash and a configured or
// explicit type args value.
// Body: { from_lock_args, to_lock_args, udt_amount, [udt_type_args], [fee_payer_lock_args] }
router.post("/build/xudt-transfer", async (req: Request, res: Response) => {
  try {
    const {
      from_lock_args,
      to_lock_args,
      udt_amount,
      udt_type_args,
      fee_payer_lock_args,
    } = req.body as {
      from_lock_args: string;
      to_lock_args: string;
      udt_amount: string;
      udt_type_args?: string;
      fee_payer_lock_args?: string;
    };

    const defaultUdtTypeArgs =
      process.env.DEFAULT_XUDT_TYPE_ARGS ??
      process.env.XUDT_TYPE_ARGS ??
      "";
    const resolvedUdtTypeArgs = udt_type_args ?? defaultUdtTypeArgs;

    if (!from_lock_args || !to_lock_args || !udt_amount || !resolvedUdtTypeArgs) {
      res.status(400).json({
        error:
          "from_lock_args, to_lock_args, udt_amount, and udt_type_args (or DEFAULT_XUDT_TYPE_ARGS/XUDT_TYPE_ARGS env) are required",
      });
      return;
    }

    const result = await buildUdtTransfer(from_lock_args, {
      to_lock_args,
      udt_type_args: resolvedUdtTypeArgs,
      udt_amount,
    });
    res.json(await finalizeBuild(result, fee_payer_lock_args, from_lock_args));
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /transactions/build/settlement ─────────────────────────────────────
// Open a payment channel — deposit buyer's UDT into a channel cell.
// Body: { buyer_lock_args, seller_lock_args, udt_type_args, udt_amount, [fee_payer_lock_args] }
router.post("/build/settlement", async (req: Request, res: Response) => {
  try {
    const { buyer_lock_args, seller_lock_args, udt_type_args, udt_amount, fee_payer_lock_args } =
      req.body as {
        buyer_lock_args: string;
        seller_lock_args: string;
        udt_type_args: string;
        udt_amount: string;
        fee_payer_lock_args?: string;
      };
    const result = await buildOpenChannel(buyer_lock_args, {
      seller_lock_args,
      udt_type_args,
      udt_amount,
    });
    res.json(await finalizeBuild(result, fee_payer_lock_args, buyer_lock_args));
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /transactions/build/dispute ────────────────────────────────────────
// Initiate/update a dispute using the last buyer-signed payment ticket.
// Body: { caller_lock_args, settlement_tx_hash, settlement_index,
//         seller_claim_udt, ticket_timestamp, buyer_sig, [fee_payer_lock_args] }
router.post("/build/dispute", async (req: Request, res: Response) => {
  try {
    const {
      caller_lock_args,
      settlement_tx_hash,
      settlement_index,
      seller_claim_udt,
      ticket_timestamp,
      buyer_sig,
      fee_payer_lock_args,
    } = req.body as {
      caller_lock_args: string;
      settlement_tx_hash: string;
      settlement_index: number;
      seller_claim_udt: string;
      ticket_timestamp: string;
      buyer_sig: string;
      fee_payer_lock_args?: string;
    };
    const result = await buildDisputeTx(caller_lock_args, {
      settlement_tx_hash,
      settlement_index,
      seller_claim_udt,
      ticket_timestamp,
      buyer_sig,
    });
    res.json(await finalizeBuild(result, fee_payer_lock_args, caller_lock_args));
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /transactions/build/coop-close ─────────────────────────────────────
// Cooperatively close the channel — both parties have agreed on the split.
// Body: { caller_lock_args, settlement_tx_hash, settlement_index,
//         seller_udt, buyer_udt, buyer_sig, seller_sig, [fee_payer_lock_args] }
router.post("/build/coop-close", async (req: Request, res: Response) => {
  try {
    const {
      caller_lock_args,
      settlement_tx_hash,
      settlement_index,
      seller_udt,
      buyer_udt,
      buyer_sig,
      seller_sig,
      fee_payer_lock_args,
    } = req.body as {
      caller_lock_args: string;
      settlement_tx_hash: string;
      settlement_index: number;
      seller_udt: string;
      buyer_udt: string;
      buyer_sig: string;
      seller_sig: string;
      fee_payer_lock_args?: string;
    };
    const result = await buildCoopClose(caller_lock_args, {
      settlement_tx_hash,
      settlement_index,
      seller_udt,
      buyer_udt,
      buyer_sig,
      seller_sig,
    });
    res.json(await finalizeBuild(result, fee_payer_lock_args, caller_lock_args));
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /transactions/build/payout ─────────────────────────────────────────
// Final payout after the 24-hour dispute window expires.
// Body: { caller_lock_args, settlement_tx_hash, settlement_index, [fee_payer_lock_args] }
router.post("/build/payout", async (req: Request, res: Response) => {
  try {
    const { caller_lock_args, settlement_tx_hash, settlement_index, fee_payer_lock_args } =
      req.body as {
        caller_lock_args: string;
        settlement_tx_hash: string;
        settlement_index: number;
        fee_payer_lock_args?: string;
      };
    const result = await buildFinalPayout(caller_lock_args, {
      settlement_tx_hash,
      settlement_index,
    });
    res.json(await finalizeBuild(result, fee_payer_lock_args, caller_lock_args));
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /transactions/submit ────────────────────────────────────────────────
// Inject a signature into an unsigned tx and broadcast it.
// Body: { tx, signature }
router.post("/submit", async (req: Request, res: Response) => {
  try {
    const { tx, signature } = req.body as { tx: object; signature: string };
    const signed = injectSignature(tx as Parameters<typeof injectSignature>[0], signature);
    const txHash = await sendTransaction(signed);
    res.json({ tx_hash: txHash });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
