// Shared onboarding taxonomy for campaign and slot derivation.
//
// Keyword flags are modeled as a 64-bit bitfield. Each keyword owns one bit:
// value = 2^bitIndex. Multiple keywords can be combined by addition.

export const KEYWORD_BIT_INDEX: Record<string, number> = {
  general: 0,
  nutrition: 1,
  tech: 2,
  crypto: 3,
  defi: 4,
  ai: 5,
  gaming: 6,
  finance: 7,
  payments: 8,
  wallets: 9,
  security: 10,
  infrastructure: 11,
  cloud: 12,
  developer_tools: 13,
  education: 14,
  news: 15,
  sports: 16,
  fitness: 17,
  food: 18,
  beauty: 19,
  fashion: 20,
  travel: 21,
  automotive: 22,
  real_estate: 23,
  healthcare: 24,
  biotech: 25,
  ecommerce: 26,
  marketplaces: 27,
  saas: 28,
  productivity: 29,
  media: 30,
  entertainment: 31,
  streaming: 32,
  social: 33,
  community: 34,
  governance: 35,
  nft: 36,
  metaverse: 37,
  climate: 38,
  energy: 39,
  enterprise: 40,
  hiring: 41,
  jobs: 42,
  legal: 43,
  insurance: 44,
  banking: 45,
  investing: 46,
  trading: 47,
  data: 48,
  analytics: 49,
  robotics: 50,
  hardware: 51,
  telecom: 52,
  family: 53,
  parenting: 54,
  pets: 55,
  home: 56,
  lifestyle: 57,
  photography: 58,
  music: 59,
  art: 60,
  books: 61,
  science: 62,
  spirituality: 63,
};

export const KEYWORD_FLAG_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(KEYWORD_BIT_INDEX).map(([keyword, bitIndex]) => [
    keyword,
    (1n << BigInt(bitIndex)).toString(),
  ]),
) as Record<string, string>;

// Onboarding-facing ad position preference mapping.
// These are the values the assistant should infer from user wording in the
// current backend flows.
export const ONBOARDING_AD_POSITION_MAP: Record<string, number> = {
  top: 1,
  header: 1,
  bottom: 2,
  footer: 2,
  side: 3,
  sidebar: 3,
};

export function formatKeywordFlagGuide(maxEntries = 16): string {
  return Object.entries(KEYWORD_FLAG_MAP)
    .slice(0, maxEntries)
    .map(([keyword, value]) => `${keyword}=${value}`)
    .join(", ");
}

export function formatAdPositionGuide(): string {
  return Object.entries(ONBOARDING_AD_POSITION_MAP)
    .map(([label, value]) => `${label}=${value}`)
    .join(", ");
}
