// CKB transaction builder — signing helpers, cell collection, and unsigned
// intent builders for plain CKB + UDT settlement + BookingSpace flow.
//
// Molecule serialization is delegated to @ckb-ccc/core.
// Business-logic binary encoding (BookingSpace data, channel lock args)
// is kept here as it is application-specific and not covered by CCC.

import { ccc } from "@ckb-ccc/core";
import blake2b from "blake2b";
import {
  client,
  ensureXudtKnownScriptLoaded,
  getFuelBalanceByLock,
  getFeeRateShannonsPerKb,
  getLiveCell,
  getTransaction,
  getTipHeader,
  type Script,
} from "./ckb.js";
import { ckbPayspaceMcpConfig, requireConfig } from "./config.js";

// ─── Constants (defaults + env overrides in config.ts) ────────────────────────

export const SECP256K1_CODE_HASH = ckbPayspaceMcpConfig.secp256k1CodeHash;
export const SECP256K1_DEP_TX_HASH = ckbPayspaceMcpConfig.secp256k1DepTxHash;

const MIN_CELL_CAPACITY = 61n * 100_000_000n;
export const UDT_CELL_CAPACITY = 142n * 100_000_000n;
const ESTIMATED_FEE = 2_000_000n;

// ─── Primitive helpers ────────────────────────────────────────────────────────

export function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex.replace(/^0x/i, ""), "hex");
}

export function bufferToHex(buf: Buffer | Uint8Array): string {
  return "0x" + Buffer.from(buf).toString("hex");
}

function hexToU32(hex: string): number {
  return parseInt(hex.replace(/^0x/i, ""), 16);
}

function hexToU64(hex: string): bigint {
  return BigInt(hex);
}

function shannonsToCkbString(value: bigint): string {
  const whole = value / 100_000_000n;
  const fraction = value % 100_000_000n;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(8, "0").replace(/0+$/, "")}`;
}

function u32LE(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

function u64LE(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n, 0);
  return b;
}

// ─── Transaction types (CKB RPC snake_case format, used as external API) ─────

export interface TxScript {
  code_hash: string;
  hash_type: string;
  args: string;
}

export interface TxOutPoint {
  tx_hash: string;
  index: string;
}

export interface TxCellDep {
  out_point: TxOutPoint;
  dep_type: string;
}

export interface TxCellInput {
  since: string;
  previous_output: TxOutPoint;
}

export interface TxCellOutput {
  capacity: string;
  lock: TxScript;
  type: TxScript | null;
}

export interface UnsignedTx {
  version: string;
  cell_deps: TxCellDep[];
  header_deps: string[];
  inputs: TxCellInput[];
  outputs: TxCellOutput[];
  outputs_data: string[];
  witnesses: string[];
}

export interface BuildResult {
  tx: UnsignedTx;
  tx_hash: string;
  signing_message: string;
  fuel?: FuelSummary;
}

export interface FuelSummary {
  fee_payer_lock_args: string;
  cell_count: number;
  usable_capacity_shannons: string;
  usable_capacity_ckb: string;
  estimated_fee_shannons: string;
  estimated_fee_ckb: string;
  required_fuel_shannons: string;
  required_fuel_ckb: string;
  projected_change_shannons: string;
  projected_change_ckb: string;
  sufficient: boolean;
}

// ─── CCC ↔ UnsignedTx conversion ─────────────────────────────────────────────

/** Convert snake_case UnsignedTx (CKB RPC format) to a CCC Transaction. */
function toCccTransaction(tx: UnsignedTx): ccc.Transaction {
  return ccc.Transaction.from({
    version: tx.version,
    cellDeps: tx.cell_deps.map((dep) => ({
      outPoint: {
        txHash: dep.out_point.tx_hash,
        index: BigInt(dep.out_point.index),
      },
      depType: dep.dep_type === "dep_group" ? "depGroup" : "code",
    })),
    headerDeps: tx.header_deps,
    inputs: tx.inputs.map((inp) => ({
      previousOutput: {
        txHash: inp.previous_output.tx_hash,
        index: BigInt(inp.previous_output.index),
      },
      since: inp.since,
    })),
    outputs: tx.outputs.map((out) => ({
      capacity: BigInt(out.capacity),
      lock: {
        codeHash: out.lock.code_hash,
        hashType: out.lock.hash_type,
        args: out.lock.args,
      },
      type: out.type
        ? {
            codeHash: out.type.code_hash,
            hashType: out.type.hash_type,
            args: out.type.args,
          }
        : null,
    })),
    outputsData: tx.outputs_data,
    witnesses: tx.witnesses,
  });
}

// ─── Signing helpers ──────────────────────────────────────────────────────────

/**
 * Build a 85-byte WitnessArgs placeholder (zeroed 65-byte lock field).
 * Uses CCC's WitnessArgs codec for correct molecule encoding.
 */
function placeholderWitnessHex(): string {
  const args = ccc.WitnessArgs.from({ lock: "0x" + "00".repeat(65) });
  return bufferToHex(args.toBytes());
}

function placeholderWitnesses(count: number): string[] {
  const ph = placeholderWitnessHex();
  return Array.from({ length: count }, (_, i) => (i === 0 ? ph : "0x"));
}

/**
 * Shared: compute hash + signing message via CCC's getSignHashInfo.
 * Uses chain-fetched input cells to correctly determine the witness group,
 * matching exactly what the secp256k1-blake160 lock script verifies on-chain.
 */
async function buildTemplate(
  tx: UnsignedTx,
  signerLockArgs: string,
): Promise<BuildResult> {
  const cccTx = toCccTransaction(tx);
  const tx_hash = cccTx.hash();
  const signerLock = ccc.Script.from({
    codeHash: SECP256K1_CODE_HASH,
    hashType: "type",
    args: signerLockArgs,
  });
  const signHashInfo = await cccTx.getSignHashInfo(signerLock, client);
  if (!signHashInfo)
    throw new Error("getSignHashInfo: no matching input found for signer lock");
  return { tx, tx_hash, signing_message: signHashInfo.message };
}

/**
 * Inject a 65-byte signature into witness[0] of an unsigned tx.
 * Uses CCC's WitnessArgs codec to ensure correct molecule encoding.
 */
export function injectSignature(
  tx: UnsignedTx,
  signatureHex: string,
): UnsignedTx {
  const sig = hexToBuffer(signatureHex);
  if (sig.length !== 65)
    throw new Error(`signature must be 65 bytes, got ${sig.length}`);
  const witnessArgs = ccc.WitnessArgs.from({ lock: signatureHex });
  const clone = { ...tx, witnesses: [...tx.witnesses] };
  clone.witnesses[0] = bufferToHex(witnessArgs.toBytes());
  return clone;
}

// ─── Cell collection ──────────────────────────────────────────────────────────

export function secp256k1Lock(lockArgs: string): Script {
  return { code_hash: SECP256K1_CODE_HASH, hash_type: "type", args: lockArgs };
}

export async function collectPlainCells(
  lockArgs: string,
  needed: bigint,
): Promise<{
  inputs: TxCellInput[];
  capacity: bigint;
  firstTxHash: string;
  firstIndex: number;
}> {
  const lock = ccc.Script.from({
    codeHash: SECP256K1_CODE_HASH,
    hashType: "type",
    args: lockArgs,
  });

  const inputs: TxCellInput[] = [];
  let capacity = 0n;
  let firstTxHash = "";
  let firstIndex = 0;

  for await (const cell of client.findCellsByLock(lock, null, true)) {
    if (cell.cellOutput.type) continue; // skip protocol cells (UDT, channel, etc.)
    if (cell.outputData && cell.outputData !== "0x") continue; // skip data cells (code cells)

    const cap = cell.cellOutput.capacity;
    const txHash = cell.outPoint.txHash;
    const idx = Number(cell.outPoint.index);

    if (firstTxHash === "") {
      firstTxHash = txHash;
      firstIndex = idx;
    }
    inputs.push({
      since: "0x0",
      previous_output: {
        tx_hash: txHash,
        index: "0x" + idx.toString(16),
      },
    });
    capacity += cap;
    if (capacity >= needed + MIN_CELL_CAPACITY) break;
  }

  if (capacity < needed + MIN_CELL_CAPACITY) {
    throw new Error(
      `insufficient funds: need ${Number(needed + MIN_CELL_CAPACITY) / 1e8} CKB, ` +
        `have ${Number(capacity) / 1e8} CKB`,
    );
  }
  if (firstTxHash === "") throw new Error("no plain cells available");

  return { inputs, capacity, firstTxHash, firstIndex };
}

export async function collectUdtCells(
  lockArgs: string,
  udtTypeScript: TxScript,
  neededAmount: bigint,
): Promise<{ inputs: TxCellInput[]; udtAmount: bigint; ckbCapacity: bigint }> {
  const lock = ccc.Script.from({
    codeHash: SECP256K1_CODE_HASH,
    hashType: "type",
    args: lockArgs,
  });
  const udtType = ccc.Script.from({
    codeHash: udtTypeScript.code_hash,
    hashType: udtTypeScript.hash_type,
    args: udtTypeScript.args,
  });

  const inputs: TxCellInput[] = [];
  let udtAmount = 0n;
  let ckbCapacity = 0n;

  for await (const cell of client.findCellsByLock(lock, udtType, true)) {
    const data = hexToBuffer(cell.outputData);
    if (data.length < 16) continue;
    const amount = data.readBigUInt64LE(0) + (data.readBigUInt64LE(8) << 64n);

    inputs.push({
      since: "0x0",
      previous_output: {
        tx_hash: cell.outPoint.txHash,
        index: "0x" + Number(cell.outPoint.index).toString(16),
      },
    });
    udtAmount += amount;
    ckbCapacity += cell.cellOutput.capacity;
    if (udtAmount >= neededAmount) break;
  }

  if (udtAmount < neededAmount)
    throw new Error(
      `insufficient UDT: need ${neededAmount}, have ${udtAmount}`,
    );

  return { inputs, udtAmount, ckbCapacity };
}

// ─── UDT data encoding ────────────────────────────────────────────────────────

export function encodeUdtAmount(amount: bigint): Buffer {
  const buf = Buffer.alloc(16);
  buf.writeBigUInt64LE(amount & 0xffffffffffffffffn, 0);
  buf.writeBigUInt64LE(amount >> 64n, 8);
  return buf;
}

// ─── Channel lock args encoding ───────────────────────────────────────────────
//
// Layout (136 bytes):
//   [0..20)    seller_blake160         — blake160(compressed_seller_pubkey)  [IMMUTABLE]
//   [20..40)   buyer_blake160          — blake160(compressed_buyer_pubkey)   [IMMUTABLE]
//   [40..72)   standard_lock_code_hash — code_hash for UDT payout cells      [IMMUTABLE]
//   [72..104)  channel_id              — blake2b(first_input_tx_hash||index) [IMMUTABLE]
//   [104..112) dispute_start_time      — LE u64 Unix ts (s); 0 = open        [MUTABLE]
//   [112..128) seller_claim_udt        — LE u128 UDT units; 0 = no claim     [MUTABLE]
//   [128..136) ticket_timestamp        — LE u64 monotonic nonce               [MUTABLE]

export function computeChannelId(txHash: string, index: number): Buffer {
  const personal = Buffer.alloc(16);
  personal.write("ckb-default-hash");
  const h = blake2b(32, undefined, undefined, personal);
  h.update(hexToBuffer(txHash));
  h.update(u32LE(index));
  return Buffer.from(h.digest());
}

export function makeWitnessArgsLock(lockField: Buffer): Buffer {
  if (lockField.length === 0) {
    const buf = Buffer.alloc(16);
    buf.writeUInt32LE(16, 0);
    buf.writeUInt32LE(16, 4);
    buf.writeUInt32LE(16, 8);
    buf.writeUInt32LE(16, 12);
    return buf;
  }
  const total = 20 + lockField.length;
  const buf = Buffer.alloc(total);
  buf.writeUInt32LE(total, 0);
  buf.writeUInt32LE(16, 4);
  buf.writeUInt32LE(total, 8);
  buf.writeUInt32LE(total, 12);
  buf.writeUInt32LE(lockField.length, 16);
  lockField.copy(buf, 20);
  return buf;
}

export function encodeChannelArgs(params: {
  sellerBlake160: string;
  buyerBlake160: string;
  standardLockCodeHash?: string;
  channelId: Buffer;
  disputeStartTime?: bigint;
  sellerClaimUdt?: bigint;
  ticketTimestamp?: bigint;
}): Buffer {
  const buf = Buffer.alloc(136);
  hexToBuffer(params.sellerBlake160).copy(buf, 0);
  hexToBuffer(params.buyerBlake160).copy(buf, 20);
  hexToBuffer(params.standardLockCodeHash ?? SECP256K1_CODE_HASH).copy(buf, 40);
  params.channelId.copy(buf, 72);
  buf.writeBigUInt64LE(params.disputeStartTime ?? 0n, 104);
  encodeUdtAmount(params.sellerClaimUdt ?? 0n).copy(buf, 112);
  buf.writeBigUInt64LE(params.ticketTimestamp ?? 0n, 128);
  return buf;
}

export function channelCellCapacity(udtTypeArgsHex: string): bigint {
  const udtArgsLen = hexToBuffer(udtTypeArgsHex).length;
  return BigInt(8 + 169 + 33 + udtArgsLen + 16) * 100_000_000n;
}

// ─── Shared cell deps ─────────────────────────────────────────────────────────

function secp256k1Dep(): TxCellDep {
  return {
    out_point: { tx_hash: SECP256K1_DEP_TX_HASH, index: "0x0" },
    dep_type: "dep_group",
  };
}

function settlementDep(): TxCellDep {
  return {
    out_point: {
      tx_hash: requireConfig(
        "SETTLEMENT_LOCK_DEP_TX_HASH",
        ckbPayspaceMcpConfig.settlementLockDepTxHash,
      ),
      index: "0x1",
    },
    dep_type: "code",
  };
}

function bookingSpaceTypeDep(): TxCellDep {
  return {
    out_point: {
      tx_hash: requireConfig(
        "BOOKING_SPACE_TYPE_DEP_TX_HASH",
        ckbPayspaceMcpConfig.bookingSpaceTypeDepTxHash,
      ),
      index: "0x0",
    },
    dep_type: "code",
  };
}

function formatCap(shannons: bigint): string {
  return "0x" + shannons.toString(16);
}

// ─── BookingSpace cell encoding ───────────────────────────────────────────────
//
// Mandatory section (92 bytes):
//   [0..33)    seller_pubkey        33 bytes  compressed secp256k1 pubkey — PERMANENTLY IMMUTABLE
//   [33..49)   price_per_mille      u128 LE   UDT base units per 1000 impressions (CPM)
//   [49..50)   ad_position          u8        0=banner,1=sidebar,2=native,3=interstitial
//   [50..51)   status               u8        0=available, 1=taken
//   [51..52)   publication_mode     u8        0=MANUAL, 1=SNIPPET_MANAGED
//   [52..60)   keyword_flags        u64 LE    content category bitfield
//   [60..92)   active_channel_id    32 bytes  payment-channel channel_id
//                                             not the settlement tx hash
//
// Optional gateway URL (variable, offset 92):
//   [92..93)   gateway_url_len      u8        byte length of gateway_url (0 = no gateway)
//   [93..93+N) gateway_url          UTF-8
//
// Optional IPFS section (offset 93+N, only present when appended):
//   [93+N]     ipfs_present         u8        1=present
//   [94+N..)   details_cid (32) + details_hash (32) when ipfs_present=1
//                                             fixed-size off-chain reference + hash only;
//                                             the details payload itself is fetched off-chain

export const BOOKING_SPACE_MANDATORY_LEN = 92;
export const PLACEMENT_CELL_CAPACITY = 200n * 100_000_000n;

function bookingSpaceCellCapacity(outputData: Buffer): bigint {
  // BookingSpace publish outputs always use:
  // - a standard secp256k1 lock (occupied size 53 with 20-byte args)
  // - a type script with empty args (adds 33 bytes)
  // So total cell-output occupied size is 8 + 53 + 33 = 94 bytes.
  // The remaining occupied capacity is the serialized BookingSpace data length.
  const occupiedBytes = 94 + outputData.length;
  return BigInt(occupiedBytes) * 100_000_000n;
}

export const AD_POSITION = {
  banner: 0,
  sidebar: 1,
  native: 2,
  interstitial: 3,
} as const;
export type AdPosition = (typeof AD_POSITION)[keyof typeof AD_POSITION];

export const PUBLICATION_MODE = { MANUAL: 0, SNIPPET_MANAGED: 1 } as const;
export type PublicationMode =
  (typeof PUBLICATION_MODE)[keyof typeof PUBLICATION_MODE];

export function encodeBookingSpaceData(params: {
  sellerPubkey: string;
  pricePerMille: bigint;
  adPosition: AdPosition;
  status: 0 | 1;
  publicationMode: PublicationMode;
  keywordFlags: bigint;
  activeChannelId?: string | undefined;
  gatewayUrl?: string | undefined;
  ipfsPresent?: boolean | undefined;
  detailsCid?: string | undefined;
  detailsHash?: string | undefined;
}): Buffer {
  const gwBytes = params.gatewayUrl
    ? Buffer.from(params.gatewayUrl, "utf8")
    : undefined;
  const gwLen = gwBytes?.length ?? 0;
  const hasIpfs = params.ipfsPresent ?? false;

  const totalLen = 92 + 1 + gwLen + (hasIpfs ? 65 : 0);
  const buf = Buffer.alloc(totalLen, 0);

  hexToBuffer(params.sellerPubkey).copy(buf, 0);
  encodeUdtAmount(params.pricePerMille).copy(buf, 33);
  buf[49] = params.adPosition;
  buf[50] = params.status;
  buf[51] = params.publicationMode;
  buf.writeBigUInt64LE(params.keywordFlags, 52);
  if (params.activeChannelId) hexToBuffer(params.activeChannelId).copy(buf, 60);
  buf[92] = gwLen;
  if (gwBytes) gwBytes.copy(buf, 93);
  if (hasIpfs) {
    buf[93 + gwLen] = 1;
    if (params.detailsCid) hexToBuffer(params.detailsCid).copy(buf, 94 + gwLen);
    if (params.detailsHash)
      hexToBuffer(params.detailsHash).copy(buf, 126 + gwLen);
  }

  return buf;
}

export function decodeBookingSpaceData(data: Buffer) {
  if (data.length < BOOKING_SPACE_MANDATORY_LEN)
    throw new Error("booking space data too short");

  const priceLo = data.readBigUInt64LE(33);
  const priceHi = data.readBigUInt64LE(41);
  const pricePerMille = priceLo + (priceHi << 64n);

  const base = {
    sellerPubkey: bufferToHex(data.subarray(0, 33)),
    pricePerMille,
    adPosition: data[49] as AdPosition,
    status: data[50] as 0 | 1,
    publicationMode: data[51] as PublicationMode,
    keywordFlags: data.readBigUInt64LE(52),
    activeChannelId: bufferToHex(data.subarray(60, 92)),
    ipfsPresent: false as boolean,
    detailsCid: null as string | null,
    detailsHash: null as string | null,
    gatewayUrl: null as string | null,
  };

  if (data.length > 92) {
    const gwLen = data[92]!;
    if (gwLen > 0 && data.length >= 93 + gwLen)
      base.gatewayUrl = data.subarray(93, 93 + gwLen).toString("utf8");

    const ipfsOffset = 93 + gwLen;
    if (data.length > ipfsOffset) {
      base.ipfsPresent = data[ipfsOffset] === 1;
      if (base.ipfsPresent && data.length >= ipfsOffset + 65) {
        base.detailsCid = bufferToHex(
          data.subarray(ipfsOffset + 1, ipfsOffset + 33),
        );
        base.detailsHash = bufferToHex(
          data.subarray(ipfsOffset + 33, ipfsOffset + 65),
        );
      }
    }
  }

  return base;
}

export const decodePlacementData = decodeBookingSpaceData;

// ─── Builder: plain CKB transfer ─────────────────────────────────────────────

export async function buildTransfer(
  lockArgs: string,
  params: { to_lock_args: string; amount_ckb: number },
): Promise<BuildResult> {
  const amountShannons = BigInt(Math.round(params.amount_ckb * 1e8));
  if (amountShannons < MIN_CELL_CAPACITY)
    throw new Error("amount below 61 CKB minimum cell capacity");

  const { inputs, capacity } = await collectPlainCells(
    lockArgs,
    amountShannons + ESTIMATED_FEE,
  );
  const changeCapacity = capacity - amountShannons - ESTIMATED_FEE;
  const senderLock = secp256k1Lock(lockArgs);
  const recipientLock = secp256k1Lock(params.to_lock_args);

  const tx: UnsignedTx = {
    version: "0x0",
    cell_deps: [secp256k1Dep()],
    header_deps: [],
    inputs,
    outputs: [
      { capacity: formatCap(amountShannons), lock: recipientLock, type: null },
      { capacity: formatCap(changeCapacity), lock: senderLock, type: null },
    ],
    outputs_data: ["0x", "0x"],
    witnesses: placeholderWitnesses(inputs.length),
  };
  return buildTemplate(tx, lockArgs);
}

export async function buildUdtTransfer(
  senderLockArgs: string,
  params: {
    to_lock_args: string;
    udt_type_args: string;
    udt_amount: string;
  },
): Promise<BuildResult> {
  const amount = BigInt(params.udt_amount);
  if (amount <= 0n) throw new Error("udt_amount must be > 0");

  const xudtKnown = await ensureXudtKnownScriptLoaded();
  const udtTypeScript: TxScript = {
    code_hash: xudtKnown.codeHash,
    hash_type: "type",
    args: params.udt_type_args,
  };

  const {
    inputs: udtInputs,
    udtAmount,
    ckbCapacity: udtCkb,
  } = await collectUdtCells(senderLockArgs, udtTypeScript, amount);

  const udtChange = udtAmount - amount;
  const outputBaseCkb =
    UDT_CELL_CAPACITY + (udtChange > 0n ? UDT_CELL_CAPACITY : 0n);
  const plainNeeded =
    outputBaseCkb + ESTIMATED_FEE > udtCkb
      ? outputBaseCkb + ESTIMATED_FEE - udtCkb
      : ESTIMATED_FEE;

  const { inputs: ckbInputs, capacity: plainCkb } = await collectPlainCells(
    senderLockArgs,
    plainNeeded,
  );

  const senderLock = secp256k1Lock(senderLockArgs);
  const recipientLock = secp256k1Lock(params.to_lock_args);
  const totalCkb = udtCkb + plainCkb;
  const ckbChange = totalCkb - outputBaseCkb - ESTIMATED_FEE;

  const outputs: TxCellOutput[] = [
    {
      capacity: formatCap(UDT_CELL_CAPACITY),
      lock: recipientLock,
      type: udtTypeScript,
    },
  ];
  const outputsData: string[] = [bufferToHex(encodeUdtAmount(amount))];

  if (udtChange > 0n) {
    outputs.push({
      capacity: formatCap(UDT_CELL_CAPACITY),
      lock: senderLock,
      type: udtTypeScript,
    });
    outputsData.push(bufferToHex(encodeUdtAmount(udtChange)));
  }

  outputs.push({
    capacity: formatCap(ckbChange),
    lock: senderLock,
    type: null,
  });
  outputsData.push("0x");

  const allInputs = [...udtInputs, ...ckbInputs];
  const tx: UnsignedTx = {
    version: "0x0",
    cell_deps: [secp256k1Dep(), xudtKnown.cellDep],
    header_deps: [],
    inputs: allInputs,
    outputs,
    outputs_data: outputsData,
    witnesses: placeholderWitnesses(allInputs.length),
  };
  return buildTemplate(tx, senderLockArgs);
}

// ─── Builder 1: Open payment channel ─────────────────────────────────────────

export async function buildOpenChannel(
  buyerLockArgs: string,
  params: {
    seller_lock_args: string;
    udt_type_args: string;
    udt_amount: string;
  },
): Promise<BuildResult> {
  const channelCodeHash = requireConfig(
    "SETTLEMENT_LOCK_CODE_HASH",
    ckbPayspaceMcpConfig.settlementLockCodeHash,
  );
  const channelHashType = ckbPayspaceMcpConfig.settlementLockHashType;

  const xudtKnown = await ensureXudtKnownScriptLoaded();
  const udtTypeScript: TxScript = {
    code_hash: xudtKnown.codeHash,
    hash_type: "type",
    args: params.udt_type_args,
  };

  const amount = BigInt(params.udt_amount);
  const cellCap = channelCellCapacity(params.udt_type_args);

  const {
    inputs: udtInputs,
    udtAmount,
    ckbCapacity: udtCkb,
  } = await collectUdtCells(buyerLockArgs, udtTypeScript, amount);
  const udtChange = udtAmount - amount;
  const outputBaseCkb = cellCap + (udtChange > 0n ? UDT_CELL_CAPACITY : 0n);
  const plainNeeded =
    outputBaseCkb + ESTIMATED_FEE > udtCkb
      ? outputBaseCkb + ESTIMATED_FEE - udtCkb
      : ESTIMATED_FEE;
  const { inputs: ckbInputs, capacity: plainCkb } = await collectPlainCells(
    buyerLockArgs,
    plainNeeded,
  );

  const allInputs = [...udtInputs, ...ckbInputs];
  if (allInputs.length === 0) throw new Error("no inputs collected");

  const first = allInputs[0]!.previous_output;
  const channelId = computeChannelId(first.tx_hash, hexToU32(first.index));

  const channelArgs = encodeChannelArgs({
    sellerBlake160: params.seller_lock_args,
    buyerBlake160: buyerLockArgs,
    channelId,
  });
  const channelLock: TxScript = {
    code_hash: channelCodeHash,
    hash_type: channelHashType,
    args: bufferToHex(channelArgs),
  };

  const buyerLock = secp256k1Lock(buyerLockArgs);
  const outputs: TxCellOutput[] = [
    { capacity: formatCap(cellCap), lock: channelLock, type: udtTypeScript },
  ];
  const outputsData: string[] = [bufferToHex(encodeUdtAmount(amount))];

  if (udtChange > 0n) {
    outputs.push({
      capacity: formatCap(UDT_CELL_CAPACITY),
      lock: buyerLock,
      type: udtTypeScript,
    });
    outputsData.push(bufferToHex(encodeUdtAmount(udtChange)));
  }

  const ckbChange = udtCkb + plainCkb - outputBaseCkb - ESTIMATED_FEE;
  outputs.push({ capacity: formatCap(ckbChange), lock: buyerLock, type: null });
  outputsData.push("0x");

  const tx: UnsignedTx = {
    version: "0x0",
    cell_deps: [secp256k1Dep(), xudtKnown.cellDep, settlementDep()],
    header_deps: [],
    inputs: allInputs,
    outputs,
    outputs_data: outputsData,
    witnesses: placeholderWitnesses(allInputs.length),
  };
  return buildTemplate(tx, buyerLockArgs);
}

// ─── Builder 2: Initiate / update dispute ────────────────────────────────────

export async function buildDisputeTx(
  callerLockArgs: string,
  params: {
    settlement_tx_hash: string;
    settlement_index: number;
    seller_claim_udt: string;
    ticket_timestamp: string;
    buyer_sig: string;
  },
): Promise<BuildResult> {
  const outPoint: TxOutPoint = {
    tx_hash: params.settlement_tx_hash,
    index: "0x" + params.settlement_index.toString(16),
  };

  const cell = await getLiveCell(
    { tx_hash: outPoint.tx_hash, index: outPoint.index },
    true,
  );
  if (!cell) throw new Error("channel cell not found or not live");
  if (!cell.output.type) throw new Error("channel cell has no type script");

  const currentArgs = hexToBuffer(cell.output.lock.args);
  if (currentArgs.length !== 136)
    throw new Error("channel lock args must be 136 bytes");

  const tip = await getTipHeader();
  const disputeStartTime = tip.timestamp / 1000n; // ms → s

  const sellerClaim = BigInt(params.seller_claim_udt);
  const ticketTimestamp = BigInt(params.ticket_timestamp);

  const channelId = Buffer.from(currentArgs.subarray(72, 104));
  const newArgs = encodeChannelArgs({
    sellerBlake160: currentArgs.subarray(0, 20).toString("hex"),
    buyerBlake160: currentArgs.subarray(20, 40).toString("hex"),
    standardLockCodeHash: currentArgs.subarray(40, 72).toString("hex"),
    channelId,
    disputeStartTime,
    sellerClaimUdt: sellerClaim,
    ticketTimestamp,
  });

  const { inputs: feeInputs, capacity: feeCap } = await collectPlainCells(
    callerLockArgs,
    ESTIMATED_FEE,
  );

  const channelInput: TxCellInput = { since: "0x0", previous_output: outPoint };
  const allInputs = [...feeInputs, channelInput];
  const channelWitnessIdx = allInputs.length - 1;

  const buyerSigBuf = hexToBuffer(params.buyer_sig);
  if (buyerSigBuf.length !== 65) throw new Error("buyer_sig must be 65 bytes");
  const disputeWitnessData = Buffer.concat([
    encodeUdtAmount(sellerClaim),
    u64LE(ticketTimestamp),
    buyerSigBuf,
  ]);

  const witnesses = placeholderWitnesses(allInputs.length);
  witnesses[channelWitnessIdx] = bufferToHex(
    makeWitnessArgsLock(disputeWitnessData),
  );

  const callerLock = secp256k1Lock(callerLockArgs);
  const feeChange = feeCap - ESTIMATED_FEE;

  const xudtKnown = await ensureXudtKnownScriptLoaded();
  const tx: UnsignedTx = {
    version: "0x0",
    cell_deps: [secp256k1Dep(), xudtKnown.cellDep, settlementDep()],
    header_deps: [tip.hash],
    inputs: allInputs,
    outputs: [
      {
        capacity: cell.output.capacity,
        lock: { ...cell.output.lock, args: bufferToHex(newArgs) },
        type: cell.output.type,
      },
      { capacity: formatCap(feeChange), lock: callerLock, type: null },
    ],
    outputs_data: [cell.output_data, "0x"],
    witnesses,
  };
  return buildTemplate(tx, callerLockArgs);
}

// ─── Builder 3: Cooperative close ────────────────────────────────────────────

export async function buildCoopClose(
  callerLockArgs: string,
  params: {
    settlement_tx_hash: string;
    settlement_index: number;
    seller_udt: string;
    buyer_udt: string;
    buyer_sig: string;
    seller_sig: string;
  },
): Promise<BuildResult & { coop_signing_message: string }> {
  const outPoint: TxOutPoint = {
    tx_hash: params.settlement_tx_hash,
    index: "0x" + params.settlement_index.toString(16),
  };

  const cell = await getLiveCell(
    { tx_hash: outPoint.tx_hash, index: outPoint.index },
    true,
  );
  if (!cell) throw new Error("channel cell not found or not live");
  if (!cell.output.type) throw new Error("channel cell has no type script");

  const args = hexToBuffer(cell.output.lock.args);
  if (args.length !== 136)
    throw new Error("channel lock args must be 136 bytes");

  const disputeStart = args.readBigUInt64LE(104);
  if (disputeStart !== 0n)
    throw new Error("channel is in dispute — use dispute/payout flow");

  const sellerUdt = BigInt(params.seller_udt);
  const buyerUdt = BigInt(params.buyer_udt);

  const cellData = hexToBuffer(cell.output_data);
  if (cellData.length < 16) throw new Error("channel cell data too short");
  const totalUdt =
    cellData.readBigUInt64LE(0) + (cellData.readBigUInt64LE(8) << 64n);
  if (sellerUdt + buyerUdt !== totalUdt)
    throw new Error(
      `amounts don't sum to channel total: ${sellerUdt} + ${buyerUdt} != ${totalUdt}`,
    );

  const stdCodeHash = args.subarray(40, 72).toString("hex");
  const sellerBlake160 = args.subarray(0, 20).toString("hex");
  const buyerBlake160 = args.subarray(20, 40).toString("hex");
  const channelId = args.subarray(72, 104);

  // Coop-close signing payload: blake2b(seller_udt(16LE) || buyer_udt(16LE) || channel_id(32))
  const coopPayload = Buffer.concat([
    encodeUdtAmount(sellerUdt),
    encodeUdtAmount(buyerUdt),
    channelId,
  ]);
  const personal = Buffer.alloc(16);
  personal.write("ckb-default-hash");
  const h = blake2b(32, undefined, undefined, personal);
  h.update(coopPayload);
  const coopSigningMessage = bufferToHex(Buffer.from(h.digest()));

  const sellerLock: TxScript = {
    code_hash: "0x" + stdCodeHash,
    hash_type: "type",
    args: "0x" + sellerBlake160,
  };
  const buyerLock: TxScript = {
    code_hash: "0x" + stdCodeHash,
    hash_type: "type",
    args: "0x" + buyerBlake160,
  };

  const { inputs: feeInputs, capacity: feeCap } = await collectPlainCells(
    callerLockArgs,
    ESTIMATED_FEE,
  );
  const channelInput: TxCellInput = { since: "0x0", previous_output: outPoint };
  const allInputs = [...feeInputs, channelInput];
  const channelWitnessIdx = allInputs.length - 1;

  const buyerSigBuf = hexToBuffer(params.buyer_sig);
  const sellerSigBuf = hexToBuffer(params.seller_sig);
  if (buyerSigBuf.length !== 65) throw new Error("buyer_sig must be 65 bytes");
  if (sellerSigBuf.length !== 65)
    throw new Error("seller_sig must be 65 bytes");

  const witnesses = placeholderWitnesses(allInputs.length);
  witnesses[channelWitnessIdx] = bufferToHex(
    makeWitnessArgsLock(Buffer.concat([buyerSigBuf, sellerSigBuf])),
  );

  const callerLock = secp256k1Lock(callerLockArgs);
  const channelCkb = hexToU64(cell.output.capacity);
  const feeChange =
    channelCkb + feeCap - 2n * UDT_CELL_CAPACITY - ESTIMATED_FEE;

  const xudtKnown = await ensureXudtKnownScriptLoaded();
  const tx: UnsignedTx = {
    version: "0x0",
    cell_deps: [secp256k1Dep(), xudtKnown.cellDep, settlementDep()],
    header_deps: [],
    inputs: allInputs,
    outputs: [
      {
        capacity: formatCap(UDT_CELL_CAPACITY),
        lock: sellerLock,
        type: cell.output.type,
      },
      {
        capacity: formatCap(UDT_CELL_CAPACITY),
        lock: buyerLock,
        type: cell.output.type,
      },
      { capacity: formatCap(feeChange), lock: callerLock, type: null },
    ],
    outputs_data: [
      bufferToHex(encodeUdtAmount(sellerUdt)),
      bufferToHex(encodeUdtAmount(buyerUdt)),
      "0x",
    ],
    witnesses,
  };
  return {
    ...(await buildTemplate(tx, callerLockArgs)),
    coop_signing_message: coopSigningMessage,
  };
}

// ─── Builder 4: Post-dispute payout ──────────────────────────────────────────

export async function buildFinalPayout(
  callerLockArgs: string,
  params: { settlement_tx_hash: string; settlement_index: number },
): Promise<BuildResult> {
  const DISPUTE_WINDOW_SECS = 86400n;

  const outPoint: TxOutPoint = {
    tx_hash: params.settlement_tx_hash,
    index: "0x" + params.settlement_index.toString(16),
  };

  const cell = await getLiveCell(
    { tx_hash: outPoint.tx_hash, index: outPoint.index },
    true,
  );
  if (!cell) throw new Error("channel cell not found or not live");
  if (!cell.output.type) throw new Error("cell has no type script");

  const args = hexToBuffer(cell.output.lock.args);
  if (args.length !== 136)
    throw new Error("channel lock args must be 136 bytes");

  const disputeStartTime = args.readBigUInt64LE(104);
  if (disputeStartTime === 0n)
    throw new Error("no dispute initiated — cannot payout");

  const deadlineSecs = disputeStartTime + DISPUTE_WINDOW_SECS;
  const tip = await getTipHeader();
  const tipTimeSecs = tip.timestamp / 1000n;
  if (tipTimeSecs < deadlineSecs)
    throw new Error(
      `dispute window has not expired yet (deadline ${deadlineSecs}s, tip ${tipTimeSecs}s)`,
    );

  const sellerClaim =
    args.readBigUInt64LE(112) + (args.readBigUInt64LE(120) << 64n);
  const cellData = hexToBuffer(cell.output_data);
  if (cellData.length < 16) throw new Error("cell data too short");
  const totalUdt =
    cellData.readBigUInt64LE(0) + (cellData.readBigUInt64LE(8) << 64n);
  const buyerClaim = totalUdt - sellerClaim;

  const stdCodeHash = args.subarray(40, 72).toString("hex");
  const sellerBlake160 = args.subarray(0, 20).toString("hex");
  const buyerBlake160 = args.subarray(20, 40).toString("hex");
  const sellerLock: TxScript = {
    code_hash: "0x" + stdCodeHash,
    hash_type: "type",
    args: "0x" + sellerBlake160,
  };
  const buyerLock: TxScript = {
    code_hash: "0x" + stdCodeHash,
    hash_type: "type",
    args: "0x" + buyerBlake160,
  };

  const sinceValue = 0xc000000000000000n | (deadlineSecs * 1000n);
  const channelInput: TxCellInput = {
    since: "0x" + sinceValue.toString(16),
    previous_output: outPoint,
  };

  const { inputs: feeInputs, capacity: feeCap } = await collectPlainCells(
    callerLockArgs,
    ESTIMATED_FEE,
  );
  const allInputs = [...feeInputs, channelInput];
  const channelWitnessIdx = allInputs.length - 1;

  const witnesses = placeholderWitnesses(allInputs.length);
  witnesses[channelWitnessIdx] = bufferToHex(
    makeWitnessArgsLock(Buffer.alloc(0)),
  );

  const channelCkb = hexToU64(cell.output.capacity);
  const callerLock = secp256k1Lock(callerLockArgs);
  const outputs: TxCellOutput[] = [];
  const outputsData: string[] = [];
  let usedCkb = 0n;

  if (sellerClaim > 0n) {
    outputs.push({
      capacity: formatCap(UDT_CELL_CAPACITY),
      lock: sellerLock,
      type: cell.output.type,
    });
    outputsData.push(bufferToHex(encodeUdtAmount(sellerClaim)));
    usedCkb += UDT_CELL_CAPACITY;
  }
  if (buyerClaim > 0n) {
    outputs.push({
      capacity: formatCap(UDT_CELL_CAPACITY),
      lock: buyerLock,
      type: cell.output.type,
    });
    outputsData.push(bufferToHex(encodeUdtAmount(buyerClaim)));
    usedCkb += UDT_CELL_CAPACITY;
  }

  const ckbRemainder = channelCkb + feeCap - usedCkb - ESTIMATED_FEE;
  outputs.push({
    capacity: formatCap(ckbRemainder),
    lock: callerLock,
    type: null,
  });
  outputsData.push("0x");

  const xudtKnown = await ensureXudtKnownScriptLoaded();
  const tx: UnsignedTx = {
    version: "0x0",
    cell_deps: [secp256k1Dep(), xudtKnown.cellDep, settlementDep()],
    header_deps: [tip.hash],
    inputs: allInputs,
    outputs,
    outputs_data: outputsData,
    witnesses,
  };
  return buildTemplate(tx, callerLockArgs);
}

// ─── Builder: Publish a new BookingSpace cell ─────────────────────────────────

export async function buildPublishPlacement(
  sellerLockArgs: string,
  params: {
    seller_pubkey: string;
    price_per_mille: string;
    ad_position: AdPosition;
    publication_mode: PublicationMode;
    keyword_flags: string;
    ipfs_present?: boolean | undefined;
    details_cid?: string | undefined;
    details_hash?: string | undefined;
    gateway_url?: string | undefined;
  },
): Promise<BuildResult> {
  const typeCodeHash = requireConfig(
    "BOOKING_SPACE_TYPE_CODE_HASH",
    ckbPayspaceMcpConfig.bookingSpaceTypeCodeHash,
  );
  const typeHashType = ckbPayspaceMcpConfig.bookingSpaceTypeHashType;

  const data = encodeBookingSpaceData({
    sellerPubkey: params.seller_pubkey,
    pricePerMille: BigInt(params.price_per_mille),
    adPosition: params.ad_position,
    status: 0,
    publicationMode: params.publication_mode,
    keywordFlags: BigInt(params.keyword_flags),
    ipfsPresent: params.ipfs_present,
    detailsCid: params.details_cid,
    detailsHash: params.details_hash,
    gatewayUrl: params.gateway_url,
  });

  const cellCapacity = bookingSpaceCellCapacity(data);

  const { inputs, capacity } = await collectPlainCells(
    sellerLockArgs,
    cellCapacity + ESTIMATED_FEE,
  );

  const sellerLock = secp256k1Lock(sellerLockArgs);
  const changeCapacity = capacity - cellCapacity - ESTIMATED_FEE;

  const tx: UnsignedTx = {
    version: "0x0",
    cell_deps: [secp256k1Dep(), bookingSpaceTypeDep()],
    header_deps: [],
    inputs,
    outputs: [
      {
        capacity: formatCap(cellCapacity),
        lock: sellerLock,
        type: { code_hash: typeCodeHash, hash_type: typeHashType, args: "0x" },
      },
      { capacity: formatCap(changeCapacity), lock: sellerLock, type: null },
    ],
    outputs_data: [bufferToHex(data), "0x"],
    witnesses: placeholderWitnesses(inputs.length),
  };
  return buildTemplate(tx, sellerLockArgs);
}

// ─── Builder: Confirm booking ─────────────────────────────────────────────────

export async function buildBookPlacement(
  sellerLockArgs: string,
  params: {
    placement_tx_hash: string;
    placement_index: number;
    channel_tx_hash: string;
  },
): Promise<BuildResult> {
  const outPoint: TxOutPoint = {
    tx_hash: params.placement_tx_hash,
    index: "0x" + params.placement_index.toString(16),
  };

  const channelTx = await getTransaction(params.channel_tx_hash);
  const firstInput = channelTx.transaction.inputs[0];
  if (!firstInput) throw new Error("channel tx has no inputs");
  const channelId = computeChannelId(
    firstInput.previous_output.tx_hash,
    hexToU32(firstInput.previous_output.index),
  );

  const cell = await getLiveCell(
    { tx_hash: outPoint.tx_hash, index: outPoint.index },
    true,
  );
  if (!cell) throw new Error("placement cell not found or not live");
  if (!cell.output.type) throw new Error("cell has no type script");
  if (cell.output.lock.args.toLowerCase() !== sellerLockArgs.toLowerCase()) {
    throw new Error("placement seller lock does not match caller");
  }

  const channelCell = await getLiveCell(
    { tx_hash: params.channel_tx_hash, index: "0x0" },
    true,
  );
  if (!channelCell)
    throw new Error(
      "settlement channel cell not found or not live at output 0",
    );

  const channelLockArgs = hexToBuffer(channelCell.output.lock.args);
  if (channelLockArgs.length !== 136) {
    throw new Error("settlement channel lock args must be 136 bytes");
  }
  const sellerFromChannel = bufferToHex(channelLockArgs.subarray(0, 20));
  if (sellerFromChannel.toLowerCase() !== sellerLockArgs.toLowerCase()) {
    throw new Error(
      "settlement channel seller does not match placement seller",
    );
  }

  const slot = decodeBookingSpaceData(hexToBuffer(cell.output_data));
  if (slot.status !== 0) throw new Error("placement is already booked");

  const updatedData = encodeBookingSpaceData({
    sellerPubkey: slot.sellerPubkey,
    pricePerMille: slot.pricePerMille,
    adPosition: slot.adPosition,
    status: 1,
    publicationMode: slot.publicationMode,
    keywordFlags: slot.keywordFlags,
    activeChannelId: bufferToHex(channelId),
    ipfsPresent: slot.ipfsPresent,
    detailsCid: slot.detailsCid ?? undefined,
    detailsHash: slot.detailsHash ?? undefined,
    gatewayUrl: slot.gatewayUrl ?? undefined,
  });

  const { inputs: feeInputs, capacity: feeCap } = await collectPlainCells(
    sellerLockArgs,
    ESTIMATED_FEE,
  );

  const placementInput: TxCellInput = {
    since: "0x0",
    previous_output: outPoint,
  };
  const allInputs = [placementInput, ...feeInputs];
  const sellerLock = secp256k1Lock(sellerLockArgs);
  const feeChange = feeCap - ESTIMATED_FEE;

  const tx: UnsignedTx = {
    version: "0x0",
    cell_deps: [secp256k1Dep(), bookingSpaceTypeDep()],
    header_deps: [],
    inputs: allInputs,
    outputs: [
      {
        capacity: cell.output.capacity,
        lock: cell.output.lock,
        type: cell.output.type,
      },
      { capacity: formatCap(feeChange), lock: sellerLock, type: null },
    ],
    outputs_data: [bufferToHex(updatedData), "0x"],
    witnesses: placeholderWitnesses(allInputs.length),
  };
  return buildTemplate(tx, sellerLockArgs);
}

// ─── Builder: Release booking ─────────────────────────────────────────────────

export async function buildCancelBooking(
  sellerLockArgs: string,
  params: { placement_tx_hash: string; placement_index: number },
): Promise<BuildResult> {
  const outPoint: TxOutPoint = {
    tx_hash: params.placement_tx_hash,
    index: "0x" + params.placement_index.toString(16),
  };

  const cell = await getLiveCell(
    { tx_hash: outPoint.tx_hash, index: outPoint.index },
    true,
  );
  if (!cell) throw new Error("placement cell not found or not live");
  if (!cell.output.type) throw new Error("cell has no type script");
  if (cell.output.lock.args.toLowerCase() !== sellerLockArgs.toLowerCase()) {
    throw new Error("placement seller lock does not match caller");
  }

  const slot = decodeBookingSpaceData(hexToBuffer(cell.output_data));

  const clearedData = encodeBookingSpaceData({
    sellerPubkey: slot.sellerPubkey,
    pricePerMille: slot.pricePerMille,
    adPosition: slot.adPosition,
    status: 0,
    publicationMode: slot.publicationMode,
    keywordFlags: slot.keywordFlags,
    ipfsPresent: slot.ipfsPresent,
    detailsCid: slot.detailsCid ?? undefined,
    detailsHash: slot.detailsHash ?? undefined,
    gatewayUrl: slot.gatewayUrl ?? undefined,
  });

  const { inputs: feeInputs, capacity: feeCap } = await collectPlainCells(
    sellerLockArgs,
    ESTIMATED_FEE,
  );

  const placementInput: TxCellInput = {
    since: "0x0",
    previous_output: outPoint,
  };
  const allInputs = [placementInput, ...feeInputs];
  const sellerLock = secp256k1Lock(sellerLockArgs);
  const feeChange = feeCap - ESTIMATED_FEE;

  const tx: UnsignedTx = {
    version: "0x0",
    cell_deps: [secp256k1Dep(), bookingSpaceTypeDep()],
    header_deps: [],
    inputs: allInputs,
    outputs: [
      {
        capacity: cell.output.capacity,
        lock: cell.output.lock,
        type: cell.output.type,
      },
      { capacity: formatCap(feeChange), lock: sellerLock, type: null },
    ],
    outputs_data: [bufferToHex(clearedData), "0x"],
    witnesses: placeholderWitnesses(allInputs.length),
  };
  return buildTemplate(tx, sellerLockArgs);
}

// ─── Fee tank injection ───────────────────────────────────────────────────────

/**
 * Estimate serialized transaction size in bytes using CCC's molecule encoder.
 * Used to calculate an accurate fee from the on-chain fee rate.
 */
function estimateTxBytes(tx: UnsignedTx): number {
  return toCccTransaction(tx).toBytes().length;
}

async function estimateTxFeeShannons(tx: UnsignedTx): Promise<bigint> {
  const feeRate = await getFeeRateShannonsPerKb();
  const bytes = estimateTxBytes(tx);
  return (BigInt(bytes) * feeRate + 999n) / 1000n;
}

export async function attachFuelPreflight(
  result: BuildResult,
  feePayerLockArgs: string,
): Promise<BuildResult> {
  const balance = await getFuelBalanceByLock(feePayerLockArgs);
  const estimatedFee = await estimateTxFeeShannons(result.tx);
  const requiredFuel = estimatedFee + MIN_CELL_CAPACITY;
  const projectedChange =
    balance.capacity > requiredFuel ? balance.capacity - requiredFuel : 0n;

  return {
    ...result,
    fuel: {
      fee_payer_lock_args: feePayerLockArgs,
      cell_count: balance.cell_count,
      usable_capacity_shannons: balance.capacity.toString(),
      usable_capacity_ckb: shannonsToCkbString(balance.capacity),
      estimated_fee_shannons: estimatedFee.toString(),
      estimated_fee_ckb: shannonsToCkbString(estimatedFee),
      required_fuel_shannons: requiredFuel.toString(),
      required_fuel_ckb: shannonsToCkbString(requiredFuel),
      projected_change_shannons: projectedChange.toString(),
      projected_change_ckb: shannonsToCkbString(projectedChange),
      sufficient: balance.capacity >= requiredFuel,
    },
  };
}

/**
 * Inject a fee-tank cell into an already-built unsigned transaction.
 *
 * Flow:
 *   1. Fetch the on-chain median fee rate (shannons / 1000 bytes).
 *   2. Collect one plain secp256k1 cell from `feePayerLockArgs`.
 *   3. Add it as an extra input + a change output back to the fee payer.
 *   4. Re-estimate the fee from the final tx byte length.
 *   5. Return an updated BuildResult with the correct signing message.
 *
 * The fee payer is typically the agent's own lock args.  Their signing key
 * covers the injected input because it shares the same secp256k1 lock group.
 */
async function injectFeeTank(
  tx: UnsignedTx,
  feePayerLockArgs: string,
): Promise<BuildResult> {
  const feeRate = await getFeeRateShannonsPerKb();

  // Rough size before injecting (add ~250 bytes for one extra input + output + witness).
  const roughBytes = estimateTxBytes(tx) + 250;
  const roughFee = (BigInt(roughBytes) * feeRate + 999n) / 1000n;

  // Collect one plain cell that covers fee + change output minimum.
  const { inputs: feeInputs, capacity: feeCap } = await collectPlainCells(
    feePayerLockArgs,
    roughFee,
  );

  const feeLock = secp256k1Lock(feePayerLockArgs);

  // Augmented tx — placeholder change capacity, will be corrected below.
  const augmented: UnsignedTx = {
    ...tx,
    inputs: [...tx.inputs, ...feeInputs],
    outputs: [...tx.outputs, { capacity: "0x0", lock: feeLock, type: null }],
    outputs_data: [...tx.outputs_data, "0x"],
    // New fee inputs get "0x" witnesses — they share the secp256k1 lock group
    // of the fee payer whose witness is already in position 0 (or their group).
    witnesses: [...tx.witnesses, ...feeInputs.map(() => "0x")],
  };

  // Compute actual fee from real serialized size.
  const actualBytes = estimateTxBytes(augmented);
  const actualFee = (BigInt(actualBytes) * feeRate + 999n) / 1000n;
  const changeCapacity = feeCap - actualFee;

  if (changeCapacity < MIN_CELL_CAPACITY) {
    throw new Error(
      `fee cell too small: need ${Number(actualFee + MIN_CELL_CAPACITY) / 1e8} CKB for fee+change, ` +
        `have ${Number(feeCap) / 1e8} CKB`,
    );
  }

  augmented.outputs[augmented.outputs.length - 1]!.capacity =
    formatCap(changeCapacity);
  return buildTemplate(augmented, feePayerLockArgs);
}

/**
 * Apply fee-tank injection to a BuildResult if `feePayerLockArgs` is provided.
 * Route handlers call this as a final step — transparent to callers.
 */
export async function applyFeeTank(
  result: BuildResult,
  feePayerLockArgs?: string,
): Promise<BuildResult> {
  if (!feePayerLockArgs) return result;
  const withFeeTank = await injectFeeTank(result.tx, feePayerLockArgs);
  return attachFuelPreflight(withFeeTank, feePayerLockArgs);
}
