import {
  AD_POSITION,
  PUBLICATION_MODE,
  decodeBookingSpaceData,
  hexToBuffer,
  type AdPosition,
  type PublicationMode,
} from "./builder.js";
import type { LiveCell } from "./ckb.js";

export type BookingSpaceView = {
  seller_pubkey: string;
  price_per_mille: string;
  ad_position: AdPosition;
  status: 0 | 1;
  publication_mode: PublicationMode;
  keyword_flags: string;
  active_channel_id: string | null;
  ipfs_present: boolean;
  details_cid: string | null;
  details_hash: string | null;
  gateway_url: string | null;
};

export type PlacementView = {
  placement_id: string;
  placement_tx_hash: string;
  placement_index: number;
  out_point: LiveCell["out_point"] & { index_number: number };
  capacity: string;
  lock: LiveCell["output"]["lock"];
  type: LiveCell["output"]["type"];
  booking_space: BookingSpaceView;
};

const AD_POSITION_LABELS: Record<AdPosition, string> = {
  [AD_POSITION.banner]: "banner",
  [AD_POSITION.sidebar]: "sidebar",
  [AD_POSITION.native]: "native",
  [AD_POSITION.interstitial]: "interstitial",
};

const PUBLICATION_MODE_LABELS: Record<PublicationMode, string> = {
  [PUBLICATION_MODE.MANUAL]: "MANUAL",
  [PUBLICATION_MODE.SNIPPET_MANAGED]: "SNIPPET_MANAGED",
};

const ZERO_32_BYTES = "0x" + "00".repeat(32);

export function normalizePlacementIndex(index: string): {
  index_hex: string;
  index_number: number;
} {
  const parsed = index.startsWith("0x") ? Number.parseInt(index.slice(2), 16) : Number(index);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`invalid placement index: ${index}`);
  }
  return {
    index_hex: "0x" + parsed.toString(16),
    index_number: parsed,
  };
}

export function formatPlacementId(txHash: string, index: number): string {
  return `${txHash}:${index}`;
}

export function matchesKeywordFlags(actual: bigint, requested?: string): boolean {
  if (requested === undefined || requested === "" || requested === "0") return true;
  const required = BigInt(requested);
  return (actual & required) === required;
}

export function publicationModeLabel(mode: PublicationMode): string {
  return PUBLICATION_MODE_LABELS[mode] ?? `UNKNOWN_${mode}`;
}

export function adPositionLabel(position: AdPosition): string {
  return AD_POSITION_LABELS[position] ?? `unknown_${position}`;
}

export function parsePublicationModeInput(value: unknown): PublicationMode | null {
  if (value === PUBLICATION_MODE.MANUAL || value === "0" || value === 0 || value === "MANUAL") {
    return PUBLICATION_MODE.MANUAL;
  }
  if (
    value === PUBLICATION_MODE.SNIPPET_MANAGED ||
    value === "1" ||
    value === 1 ||
    value === "SNIPPET_MANAGED"
  ) {
    return PUBLICATION_MODE.SNIPPET_MANAGED;
  }
  return null;
}

export function parseAdPositionInput(value: unknown): AdPosition | null {
  if (value === AD_POSITION.banner || value === "0" || value === 0 || value === "banner") {
    return AD_POSITION.banner;
  }
  if (value === AD_POSITION.sidebar || value === "1" || value === 1 || value === "sidebar") {
    return AD_POSITION.sidebar;
  }
  if (value === AD_POSITION.native || value === "2" || value === 2 || value === "native") {
    return AD_POSITION.native;
  }
  if (
    value === AD_POSITION.interstitial ||
    value === "3" ||
    value === 3 ||
    value === "interstitial"
  ) {
    return AD_POSITION.interstitial;
  }
  return null;
}

export function parseBooleanInput(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  throw new Error(`invalid boolean value: ${String(value)}`);
}

export function assertHexByteLength(value: string, byteLength: number, fieldName: string): void {
  const raw = value.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length !== byteLength * 2) {
    throw new Error(`${fieldName} must be a ${byteLength}-byte hex string`);
  }
}

export function formatPlacementCell(cell: LiveCell): PlacementView {
  const decoded = decodeBookingSpaceData(hexToBuffer(cell.output_data));
  const indexNumber = Number.parseInt(cell.out_point.index.replace(/^0x/i, ""), 16);
  const activeChannelId =
    decoded.status === 1 && decoded.activeChannelId !== ZERO_32_BYTES
      ? decoded.activeChannelId
      : null;
  const bookingSpace: BookingSpaceView = {
    seller_pubkey: decoded.sellerPubkey,
    price_per_mille: decoded.pricePerMille.toString(),
    ad_position: decoded.adPosition,
    status: decoded.status,
    publication_mode: decoded.publicationMode,
    keyword_flags: decoded.keywordFlags.toString(),
    active_channel_id: activeChannelId,
    ipfs_present: decoded.ipfsPresent,
    details_cid: decoded.detailsCid,
    details_hash: decoded.detailsHash,
    gateway_url: decoded.gatewayUrl,
  };

  return {
    placement_id: formatPlacementId(cell.out_point.tx_hash, indexNumber),
    placement_tx_hash: cell.out_point.tx_hash,
    placement_index: indexNumber,
    out_point: {
      ...cell.out_point,
      index_number: indexNumber,
    },
    capacity: cell.output.capacity,
    lock: cell.output.lock,
    type: cell.output.type,
    booking_space: bookingSpace,
  };
}
