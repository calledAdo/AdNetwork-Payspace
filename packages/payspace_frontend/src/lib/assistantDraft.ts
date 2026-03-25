export type AssistantDraftType =
  | "campaign_init"
  | "seller_profile_init"
  | "seller_slot_init";

export type AssistantDraftEnvelope = {
  draft_type: AssistantDraftType;
  payload: Record<string, unknown>;
};

const DRAFT_BLOCK_PATTERN = /```draft\s*([\s\S]*?)```/m;

export function parseAssistantDraft(raw: string): AssistantDraftEnvelope | null {
  const match = raw.match(DRAFT_BLOCK_PATTERN);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const typed = parsed as Record<string, unknown>;
    const draftType = typed["draft_type"];
    const payload = typed["payload"];
    if (
      (draftType === "campaign_init" ||
        draftType === "seller_profile_init" ||
        draftType === "seller_slot_init") &&
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload)
    ) {
      return {
        draft_type: draftType,
        payload: payload as Record<string, unknown>,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function stripAssistantDraft(raw: string): string {
  return raw.replace(DRAFT_BLOCK_PATTERN, "").trim();
}
