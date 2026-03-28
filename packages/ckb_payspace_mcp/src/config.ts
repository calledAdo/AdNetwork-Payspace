import {
  PAYSPACE_BOOKING_SPACE_TYPE_CODE_HASH,
  PAYSPACE_BOOKING_SPACE_TYPE_DEP_TX_HASH,
  PAYSPACE_BOOKING_SPACE_TYPE_HASH_TYPE,
  PAYSPACE_SETTLEMENT_LOCK_CODE_HASH,
  PAYSPACE_SETTLEMENT_LOCK_DEP_TX_HASH,
  PAYSPACE_SETTLEMENT_LOCK_HASH_TYPE,
} from "./constants.js";

export const ckbPayspaceMcpConfig = {
  ckbRpcUrl: process.env.CKB_RPC_URL ?? "https://testnet.ckb.dev/",
  defaultXudtTypeArgs: process.env.DEFAULT_XUDT_TYPE_ARGS ?? "",

  // secp256k1-blake160 (standard lock) — override for custom deployments
  secp256k1CodeHash:
    process.env.SECP256K1_CODE_HASH ??
    "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
  secp256k1DepTxHash:
    process.env.SECP256K1_DEP_TX_HASH ??
    "0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37",

  // BookingSpace + settlement locks — from canonical testnet deployment (constants.ts)
  bookingSpaceTypeCodeHash: PAYSPACE_BOOKING_SPACE_TYPE_CODE_HASH,
  bookingSpaceTypeDepTxHash: PAYSPACE_BOOKING_SPACE_TYPE_DEP_TX_HASH,
  bookingSpaceTypeHashType: PAYSPACE_BOOKING_SPACE_TYPE_HASH_TYPE,

  settlementLockCodeHash: PAYSPACE_SETTLEMENT_LOCK_CODE_HASH,
  settlementLockDepTxHash: PAYSPACE_SETTLEMENT_LOCK_DEP_TX_HASH,
  settlementLockHashType: PAYSPACE_SETTLEMENT_LOCK_HASH_TYPE,
};

export function requireConfig(name: string, value: string): string {
  if (!value) throw new Error(`${name} env var not set`);
  return value;
}
