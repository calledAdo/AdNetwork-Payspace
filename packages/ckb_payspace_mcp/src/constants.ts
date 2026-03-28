/**
 * Canonical PaySpace on-chain script references (CKB testnet / bundled deployment).
 * Not read from environment — change here only when the protocol deploys new cells.
 */

export const PAYSPACE_BOOKING_SPACE_TYPE_CODE_HASH =
  "0x04d06a9d14324ccd64330d09789c6e58aff38ef845db49855ef365e0d768bc9d";

export const PAYSPACE_BOOKING_SPACE_TYPE_DEP_TX_HASH =
  "0x8b3b2060c795ae7bec86d84c20255314a258933641706e4ec0c634cd9704b04e";

/** Hash type for BookingSpace **type** script on-chain (matches deployed cells). */
export const PAYSPACE_BOOKING_SPACE_TYPE_HASH_TYPE = "data1" as const;

export const PAYSPACE_SETTLEMENT_LOCK_CODE_HASH =
  "0xbaa0260440e7fc70e040e5c3d2a0ce310a4377076d2aae98778d6519624daf8a";

export const PAYSPACE_SETTLEMENT_LOCK_DEP_TX_HASH =
  "0x8b3b2060c795ae7bec86d84c20255314a258933641706e4ec0c634cd9704b04e";

/** Hash type for settlement **lock** script on-chain (matches deployed cells). */
export const PAYSPACE_SETTLEMENT_LOCK_HASH_TYPE = "data1" as const;
