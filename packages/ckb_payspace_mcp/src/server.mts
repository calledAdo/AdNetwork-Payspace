#!/usr/bin/env npx tsx
/// <reference types="node" />

/**
 * CKB PaySpace MCP Server
 *
 * A comprehensive Model Context Protocol server that exposes the full
 * PaySpace ad marketplace on-chain operations as MCP tools. This replaces
 * the Express-based packages/mcp server.
 *
 * All chain operations go through @ckb-ccc/core directly.
 * Multiple skills depend on this MCP as a shared npm package:
 *   - payment_channel  (settlement, dispute, coop-close, payout)
 *   - adspace_v1  (discover, publish, book, cancel)
 *   - asset_manager  (transfer, xudt-transfer)
 *   - native_signer  (cell queries for key verification)
 *
 * Usage:  npx tsx src/server.mts
 * Transport: stdio
 *
 * The agent workflow is:
 *   1. Check if MCP server is running
 *   2. Call a build tool (e.g. build_settlement)
 *   3. Route the signing_message to native_signer skill
 *   4. Call submit_transaction with the signed result
 *
 * Environment:
 *   CKB_RPC_URL            — CKB testnet RPC (default: https://testnet.ckb.dev/)
 *   DEFAULT_XUDT_TYPE_ARGS — default xUDT type args (token instance)
 *
 * xUDT script code hash + cell dep come from CCC KnownScript at runtime (not env).
 * BookingSpace + settlement lock script IDs are fixed in src/constants.ts (not env).
 */

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Self-contained — builder and ckb modules live inside this package.
import {
  buildTransfer,
  buildUdtTransfer,
  buildOpenChannel,
  buildDisputeTx,
  buildCoopClose,
  buildFinalPayout,
  buildPublishPlacement,
  buildBookPlacement,
  buildCancelBooking,
  attachFuelPreflight,
  injectSignature,
  decodeBookingSpaceData,
  type BuildResult,
} from "./builder.js";

import {
  client,
  getCellsByScript,
  getLiveCell,
  getTransaction,
  sendTransaction,
  getFuelBalanceByLock,
  getTipHeader,
  SECP256K1_CODE_HASH,
  type Script,
} from "./ckb.js";
import { ckbPayspaceMcpConfig } from "./config.js";
import {
  PAYSPACE_BOOKING_SPACE_TYPE_CODE_HASH,
  PAYSPACE_BOOKING_SPACE_TYPE_HASH_TYPE,
} from "./constants.js";

// ── MCP Server ────────────────────────────────────────────────────────

const server = new McpServer({
  name: "ckb_payspace",
  version: "1.0.0",
});

// ── Helper ────────────────────────────────────────────────────────────

function resultText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

async function finalizeBuild(
  result: BuildResult,
  callerLockArgs: string,
) {
  return attachFuelPreflight(result, callerLockArgs);
}

// ═══════════════════════════════════════════════════════════════════════
// TRANSACTION TOOLS (payment_channel + asset_manager)
// ═══════════════════════════════════════════════════════════════════════

server.registerTool(
  "build_transfer",
  {
    description: "Build a plain CKB transfer transaction",
    inputSchema: {
      from_lock_args: z.string().describe("Sender blake160 lock args"),
      to_lock_args: z.string().describe("Recipient blake160 lock args"),
      amount_ckb: z.number().describe("Amount in CKB to send"),
    },
  },
  async ({ from_lock_args, to_lock_args, amount_ckb }) => {
    const result = await buildTransfer(from_lock_args, { to_lock_args, amount_ckb });
    return resultText(await finalizeBuild(result, from_lock_args));
  },
);

server.registerTool(
  "build_xudt_transfer",
  {
    description: "Build an xUDT token transfer transaction",
    inputSchema: {
      from_lock_args: z.string().describe("Sender blake160 lock args"),
      to_lock_args: z.string().describe("Recipient blake160 lock args"),
      udt_amount: z.string().describe("Amount of UDT to send"),
      udt_type_args: z.string().optional().describe("xUDT type script args"),
    },
  },
  async ({ from_lock_args, to_lock_args, udt_amount, udt_type_args }) => {
    const resolved = udt_type_args ?? ckbPayspaceMcpConfig.defaultXudtTypeArgs;
    const result = await buildUdtTransfer(from_lock_args, {
      to_lock_args,
      udt_type_args: resolved,
      udt_amount,
    });
    return resultText(await finalizeBuild(result, from_lock_args));
  },
);

server.registerTool(
  "build_settlement",
  {
    description: "Build a payment channel settlement (open) transaction. Deposits buyer UDT into a channel cell.",
    inputSchema: {
      buyer_lock_args: z.string().describe("Buyer blake160 lock args"),
      seller_lock_args: z.string().describe("Seller blake160 lock args"),
      udt_type_args: z.string().describe("xUDT type script args"),
      udt_amount: z.string().describe("Total xUDT to lock in the channel"),
    },
  },
  async ({ buyer_lock_args, seller_lock_args, udt_type_args, udt_amount }) => {
    const result = await buildOpenChannel(buyer_lock_args, {
      seller_lock_args,
      udt_type_args,
      udt_amount,
    });
    return resultText(await finalizeBuild(result, buyer_lock_args));
  },
);

server.registerTool(
  "build_dispute",
  {
    description: "Build a dispute transaction using the last buyer-signed payment ticket",
    inputSchema: {
      caller_lock_args: z.string().describe("Caller blake160 lock args"),
      settlement_tx_hash: z.string().describe("Settlement tx hash"),
      settlement_index: z.number().describe("Settlement output index"),
      seller_claim_udt: z.string().describe("Seller claim amount from ticket"),
      ticket_timestamp: z.string().describe("Ticket timestamp nonce"),
      buyer_sig: z.string().describe("Buyer signature on ticket"),
    },
  },
  async ({ caller_lock_args, settlement_tx_hash, settlement_index, seller_claim_udt, ticket_timestamp, buyer_sig }) => {
    const result = await buildDisputeTx(caller_lock_args, {
      settlement_tx_hash,
      settlement_index,
      seller_claim_udt,
      ticket_timestamp,
      buyer_sig,
    });
    return resultText(await finalizeBuild(result, caller_lock_args));
  },
);

server.registerTool(
  "build_coop_close",
  {
    description: "Build a cooperative close transaction — both parties agreed on the UDT split",
    inputSchema: {
      caller_lock_args: z.string().describe("Caller blake160 lock args"),
      settlement_tx_hash: z.string().describe("Settlement tx hash"),
      settlement_index: z.number().describe("Settlement output index"),
      seller_udt: z.string().describe("UDT amount for seller"),
      buyer_udt: z.string().describe("UDT amount returned to buyer"),
      buyer_sig: z.string().describe("Buyer signature"),
      seller_sig: z.string().describe("Seller signature"),
    },
  },
  async ({ caller_lock_args, settlement_tx_hash, settlement_index, seller_udt, buyer_udt, buyer_sig, seller_sig }) => {
    const result = await buildCoopClose(caller_lock_args, {
      settlement_tx_hash,
      settlement_index,
      seller_udt,
      buyer_udt,
      buyer_sig,
      seller_sig,
    });
    return resultText(await finalizeBuild(result, caller_lock_args));
  },
);

server.registerTool(
  "build_payout",
  {
    description: "Build a payout transaction after the 24-hour dispute window expires",
    inputSchema: {
      caller_lock_args: z.string().describe("Caller blake160 lock args"),
      settlement_tx_hash: z.string().describe("Settlement tx hash"),
      settlement_index: z.number().describe("Settlement output index"),
    },
  },
  async ({ caller_lock_args, settlement_tx_hash, settlement_index }) => {
    const result = await buildFinalPayout(caller_lock_args, {
      settlement_tx_hash,
      settlement_index,
    });
    return resultText(await finalizeBuild(result, caller_lock_args));
  },
);

server.registerTool(
  "submit_transaction",
  {
    description: "Inject a signature into an unsigned tx and broadcast it to the CKB network. Route the signing_message from a build tool to native_signer, then call this with the result.",
    inputSchema: {
      tx: z.string().describe("JSON-encoded unsigned CKB transaction from a build tool"),
      signature: z.string().describe("Hex signature from native_signer"),
    },
  },
  async ({ tx, signature }) => {
    const parsed = JSON.parse(tx);
    const signed = injectSignature(parsed, signature);
    const txHash = await sendTransaction(signed);
    return resultText({ tx_hash: txHash });
  },
);

// ═══════════════════════════════════════════════════════════════════════
// PLACEMENT + DISCOVERY TOOLS (adspace_v1)
// ═══════════════════════════════════════════════════════════════════════

server.registerTool(
  "build_publish_placement",
  {
    description: "Build a BookingSpace slot publication transaction (seller creates a new ad slot on-chain)",
    inputSchema: {
      seller_lock_args: z.string().describe("Seller blake160 lock args"),
      seller_pubkey: z.string().describe("Seller secp256k1 public key"),
      price_per_mille: z.string().describe("Floor price per 1000 impressions in UDT"),
      ad_position: z.number().describe("0=banner, 1=sidebar, 2=native, 3=interstitial"),
      publication_mode: z.number().describe("0=manual, 1=snippet-managed"),
      keyword_flags: z.string().describe("Content policy keyword flags"),
      gateway_url: z.string().optional().describe("Seller A2A gateway URL"),
    },
  },
  async ({ seller_lock_args, seller_pubkey, price_per_mille, ad_position, publication_mode, keyword_flags, gateway_url }) => {
    const result = await buildPublishPlacement(seller_lock_args, {
      seller_pubkey,
      price_per_mille,
      ad_position: ad_position as 0 | 1 | 2 | 3,
      publication_mode: publication_mode as 0 | 1,
      keyword_flags,
      gateway_url,
    });
    return resultText(await finalizeBuild(result, seller_lock_args));
  },
);

server.registerTool(
  "build_book_placement",
  {
    description: "Build a slot booking transaction (seller marks slot as taken with a channel reference)",
    inputSchema: {
      seller_lock_args: z.string().describe("Seller blake160 lock args"),
      placement_tx_hash: z.string().describe("Current placement tx hash"),
      placement_index: z.number().describe("Current placement output index"),
      channel_tx_hash: z.string().describe("Payment channel settlement tx hash"),
    },
  },
  async ({ seller_lock_args, placement_tx_hash, placement_index, channel_tx_hash }) => {
    const result = await buildBookPlacement(seller_lock_args, {
      placement_tx_hash,
      placement_index,
      channel_tx_hash,
    });
    return resultText(await finalizeBuild(result, seller_lock_args));
  },
);

server.registerTool(
  "build_cancel_booking",
  {
    description: "Build a cancel/unbook transaction (seller resets slot to available)",
    inputSchema: {
      seller_lock_args: z.string().describe("Seller blake160 lock args"),
      placement_tx_hash: z.string().describe("Current placement tx hash"),
      placement_index: z.number().describe("Current placement output index"),
    },
  },
  async ({ seller_lock_args, placement_tx_hash, placement_index }) => {
    const result = await buildCancelBooking(seller_lock_args, {
      placement_tx_hash,
      placement_index,
    });
    return resultText(await finalizeBuild(result, seller_lock_args));
  },
);

// ═══════════════════════════════════════════════════════════════════════
// CELL QUERY TOOLS (shared — used by all skills)
// ═══════════════════════════════════════════════════════════════════════

server.registerTool(
  "get_live_cell",
  {
    description: "Check if a specific cell is live on-chain and return its data",
    inputSchema: {
      tx_hash: z.string().describe("Transaction hash of the cell"),
      index: z.string().describe("Output index (hex, e.g. '0x0')"),
    },
  },
  async ({ tx_hash, index }) => {
    const cell = await getLiveCell({ tx_hash, index });
    if (!cell) return resultText({ live: false });
    return resultText({ live: true, ...cell });
  },
);

server.registerTool(
  "get_cells_by_lock",
  {
    description: "Query live cells owned by a secp256k1-blake160 lock",
    inputSchema: {
      lock_args: z.string().describe("Blake160 lock args"),
      limit: z.number().optional().describe("Max results (default 100)"),
    },
  },
  async ({ lock_args, limit }) => {
    const script: Script = {
      code_hash: SECP256K1_CODE_HASH,
      hash_type: "type",
      args: lock_args,
    };
    const result = await getCellsByScript(script, "lock", limit ?? 100);
    return resultText(result);
  },
);

server.registerTool(
  "get_cells_by_type",
  {
    description: "Query live cells by type script (e.g. for xUDT or BookingSpace cells)",
    inputSchema: {
      code_hash: z.string().describe("Type script code hash"),
      hash_type: z.string().optional().describe("Hash type (default 'type')"),
      args: z.string().optional().describe("Type script args (default '0x')"),
      limit: z.number().optional().describe("Max results"),
    },
  },
  async ({ code_hash, hash_type, args, limit }) => {
    const script: Script = {
      code_hash,
      hash_type: hash_type ?? "type",
      args: args ?? "0x",
    };
    const result = await getCellsByScript(script, "type", limit ?? 100);
    return resultText(result);
  },
);

server.registerTool(
  "get_fuel_balance",
  {
    description: "Get the spendable CKB fuel balance for a lock (plain cells only, no UDT)",
    inputSchema: {
      lock_args: z.string().describe("Blake160 lock args"),
    },
  },
  async ({ lock_args }) => {
    const result = await getFuelBalanceByLock(lock_args);
    return resultText({
      lock_args,
      cell_count: result.cell_count,
      capacity_shannons: result.capacity.toString(),
      capacity_ckb: (Number(result.capacity) / 1e8).toFixed(8),
    });
  },
);

server.registerTool(
  "get_transaction",
  {
    description: "Fetch a transaction by hash with status",
    inputSchema: {
      tx_hash: z.string().describe("Transaction hash"),
    },
  },
  async ({ tx_hash }) => {
    const result = await getTransaction(tx_hash);
    return resultText(result);
  },
);

server.registerTool(
  "get_tip_header",
  {
    description: "Get the latest block header from the CKB chain",
    inputSchema: {},
  },
  async () => {
    const header = await getTipHeader();
    return resultText(header);
  },
);

// ═══════════════════════════════════════════════════════════════════════
// DISCOVERY TOOLS (adspace_v1)
// ═══════════════════════════════════════════════════════════════════════

server.registerTool(
  "discover_placements",
  {
    description: "Discover available BookingSpace ad slots on-chain. Returns decoded placement data with gateway URLs for seller contact.",
    inputSchema: {
      status: z.number().optional().describe("0=available, 1=taken (default: 0)"),
      ad_position: z.number().optional().describe("Filter by ad position"),
      max_price: z.string().optional().describe("Max price per 1000 impressions"),
      keyword_flags: z.string().optional().describe("Required keyword flags"),
      limit: z.number().optional().describe("Max results (default 100)"),
    },
  },
  async ({ status, ad_position, max_price, keyword_flags, limit }) => {
    const typeScript: Script = {
      code_hash: PAYSPACE_BOOKING_SPACE_TYPE_CODE_HASH,
      hash_type: PAYSPACE_BOOKING_SPACE_TYPE_HASH_TYPE,
      args: "0x",
    };

    const result = await getCellsByScript(typeScript, "type", limit ?? 100);
    const placements = result.objects
      .map((cell) => {
        if (!cell.output_data || cell.output_data === "0x") return null;
        try {
          const data = Buffer.from(cell.output_data.slice(2), "hex");
          const decoded = decodeBookingSpaceData(data);
          return { ...cell, booking_space: decoded };
        } catch {
          return null;
        }
      })
      .filter((p): p is NonNullable<typeof p> => !!p)
      .filter((p) => {
        if (status !== undefined && p.booking_space.status !== status) return false;
        if (ad_position !== undefined && p.booking_space.adPosition !== ad_position) return false;
        if (max_price !== undefined && BigInt(p.booking_space.pricePerMille) > BigInt(max_price)) return false;
        return true;
      });

    return resultText({ total: placements.length, placements });
  },
);

server.registerTool(
  "get_placement",
  {
    description: "Fetch a single BookingSpace placement cell with decoded data",
    inputSchema: {
      tx_hash: z.string().describe("Placement tx hash"),
      index: z.string().describe("Placement output index (hex)"),
    },
  },
  async ({ tx_hash, index }) => {
    const cell = await getLiveCell({ tx_hash, index });
    if (!cell) return resultText({ error: "cell not found or spent" });
    try {
      const data = Buffer.from(cell.output_data.slice(2), "hex");
      const decoded = decodeBookingSpaceData(data);
      return resultText({
        placement_id: `${tx_hash}:${index}`,
        ...cell,
        booking_space: decoded,
      });
    } catch (err) {
      return resultText({ error: "failed to decode BookingSpace data", raw: cell });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════════════

const transport = new StdioServerTransport();
await server.connect(transport);
