const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim() ||
  "http://localhost:4000";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const data = (await response.json().catch(() => null)) as T | { error?: string } | null;
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return data as T;
}

export type SellerProfile = {
  owner_pubkey: string;
  site_url: string;
  block_id: string | null;
  agent_id: string | null;
  agent_pubkey: string | null;
  agent_status: "none" | "pending" | "active" | "error";
  created_at: string;
  updated_at: string;
};

export type SellerSlotDetails = {
  schema_version: 1;
  snippet_id: string;
  owner_pubkey: string;
  page_url: string | null;
  dimensions: string | null;
  min_amount_per_1000: string;
  ad_position: number;
  publication_mode: number;
  keyword_flags: string;
  policy_text: string | null;
  metadata: Record<string, unknown> | null;
  installation: {
    status: "awaiting_install" | "publishing" | "disabled";
  };
  created_at: string;
};

export type Creative = {
  image_url: string;
  click_url: string;
  write_up?: string;
};

export type CampaignCore = {
  campaign_id: string;
  owner_pubkey: string;
  name: string;
  total_budget_udt: string;
  max_price_per_mille: string;
  keyword_flags: string;
  ad_position: number;
  creative: Creative;
  created_at: string;
  updated_at: string;
};

export type CampaignDetails = {
  campaign_core: CampaignCore;
  block_id: string | null;
  agent_id: string | null;
  agent_pubkey: string | null;
  agent_status: "none" | "pending" | "active" | "error";
  status: "pending" | "active" | "paused" | "completed" | "error";
};

export type BuyerAgentMetrics = {
  agentId: string;
  agentType: "buyer";
  initConfig?: Record<string, unknown>;
  stats?: {
    last_report_date?: string | null;
    total_spend_udt?: string;
    total_impressions?: number;
    active_placement_count?: number;
  };
  placements?: Array<Record<string, unknown>>;
};

export type SellerAgentMetrics = {
  agentId: string;
  agentType: "seller";
  initConfig?: Record<string, unknown>;
  stats?: {
    last_report_date?: string | null;
    total_revenue_udt?: string;
    total_impressions_served?: number;
    slots_total?: number;
    slots_active?: number;
  };
  slots?: Array<Record<string, unknown>>;
};

export type AgentConversationSummary = {
  contextId: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  messageCount: number;
  hasSummary: boolean;
};

export type TrackingStats = {
  metric_id: string;
  impressions: number;
  clicks: number;
  ctr: number;
  geo_impressions: Record<string, number>;
  geo_clicks: Record<string, number>;
};

export type SnippetRecord = {
  slot_details: SellerSlotDetails;
  content: {
    snippet_id: string;
    version: number;
    status: "inactive" | "active";
    image_url: string | null;
    action_url: string | null;
    write_up: string | null;
    updated_at: string;
  };
  seller_impression_tracking_url: string;
  seller_click_tracking_url: string;
  snippet_seen_url: string;
  loader_url: string;
  embed_html: string;
};

export type AssistantResponse = {
  thread_id: string;
  subject_type: "seller_profile" | "campaign" | null;
  subject_id: string | null;
  lifecycle: "draft" | "active" | "missing";
  route_mode: "backend" | "agent";
  response_source: "backend" | "agent";
  reply: string;
};

export async function createPublisherProfile(input: {
  owner_pubkey: string;
  site_url: string;
  block_id?: string | null;
}): Promise<SellerProfile> {
  return requestJson<SellerProfile>("/publishers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createCampaign(input: {
  owner_pubkey: string;
  name: string;
  total_budget_udt: string;
  max_price_per_mille: string;
  keyword_flags: string;
  ad_position: number;
  block_id?: string | null;
  creative: Creative;
}): Promise<{ campaign_id: string; agent_status: string; message: string }> {
  return requestJson("/campaigns", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createPublisherSlot(
  ownerPubkey: string,
  input: {
    snippet_id?: string;
    page_url?: string | null;
    dimensions?: string | null;
    min_amount_per_1000?: string;
    ad_position?: number;
    publication_mode?: number;
    keyword_flags?: string;
    policy_text?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<{
  slot: SellerSlotDetails;
  install: {
    snippet_id: string;
    loader_url: string;
    embed_html: string;
    status: "awaiting_install" | "publishing" | "disabled";
  };
  agent_status: string;
  command_result: unknown;
}> {
  return requestJson(`/publishers/${encodeURIComponent(ownerPubkey)}/slots`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function sendAssistantMessage(input: {
  thread_id?: string | null;
  subject_type?: "seller_profile" | "campaign" | null;
  subject_id?: string | null;
  message: string;
  route_mode?: "auto" | "backend" | "agent";
  context?: Record<string, unknown>;
}): Promise<AssistantResponse> {
  return requestJson<AssistantResponse>("/assistant/messages", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function fetchCampaign(campaignId: string): Promise<CampaignDetails> {
  return requestJson<CampaignDetails>(`/campaigns/${encodeURIComponent(campaignId)}`);
}

export async function fetchCampaignMetrics(campaignId: string): Promise<BuyerAgentMetrics> {
  return requestJson<BuyerAgentMetrics>(`/campaigns/${encodeURIComponent(campaignId)}/metrics`);
}

export async function fetchCampaignConversations(campaignId: string): Promise<{
  agentId: string;
  conversations: AgentConversationSummary[];
}> {
  return requestJson(`/campaigns/${encodeURIComponent(campaignId)}/conversations`);
}

export async function fetchCampaignConversation(campaignId: string, contextId: string): Promise<unknown> {
  return requestJson(
    `/campaigns/${encodeURIComponent(campaignId)}/conversations/${encodeURIComponent(contextId)}`,
  );
}

export async function fetchTrackingStats(metricId: string): Promise<TrackingStats> {
  return requestJson(`/tracking/stats/${encodeURIComponent(metricId)}`);
}

export async function fetchPublisher(ownerPubkey: string): Promise<SellerProfile & {
  slot_count: number;
  agent_binding?: unknown;
}> {
  return requestJson(`/publishers/${encodeURIComponent(ownerPubkey)}`);
}

export async function fetchPublisherSlots(ownerPubkey: string): Promise<{
  owner_pubkey: string;
  total: number;
  slots: SellerSlotDetails[];
}> {
  return requestJson(`/publishers/${encodeURIComponent(ownerPubkey)}/slots`);
}

export async function fetchPublisherMetrics(ownerPubkey: string): Promise<SellerAgentMetrics> {
  return requestJson<SellerAgentMetrics>(`/publishers/${encodeURIComponent(ownerPubkey)}/metrics`);
}

export async function fetchPublisherConversations(ownerPubkey: string): Promise<{
  agentId: string;
  conversations: AgentConversationSummary[];
}> {
  return requestJson(`/publishers/${encodeURIComponent(ownerPubkey)}/conversations`);
}

export async function fetchPublisherConversation(
  ownerPubkey: string,
  contextId: string,
): Promise<unknown> {
  return requestJson(
    `/publishers/${encodeURIComponent(ownerPubkey)}/conversations/${encodeURIComponent(contextId)}`,
  );
}

export async function fetchSnippetRecord(snippetId: string): Promise<SnippetRecord> {
  return requestJson(`/tracking/snippet/${encodeURIComponent(snippetId)}`);
}

export function extractAgentReply(payload: unknown): string {
  if (!payload || typeof payload !== "object") return JSON.stringify(payload);
  const typed = payload as Record<string, unknown>;
  const choices = Array.isArray(typed["choices"])
    ? (typed["choices"] as Array<Record<string, unknown>>)
    : [];
  const first = choices[0];
  const message = first?.["message"];
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const content = (message as Record<string, unknown>)["content"];
    if (typeof content === "string" && content.trim()) return content;
  }
  return JSON.stringify(payload);
}

export async function sendCampaignAgentChat(campaignId: string, message: string): Promise<string> {
  const payload = await requestJson<unknown>(`/campaigns/${encodeURIComponent(campaignId)}/chat`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
  return extractAgentReply(payload);
}

export async function sendPublisherAgentChat(ownerPubkey: string, message: string): Promise<string> {
  const payload = await requestJson<unknown>(`/publishers/${encodeURIComponent(ownerPubkey)}/chat`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
  return extractAgentReply(payload);
}
