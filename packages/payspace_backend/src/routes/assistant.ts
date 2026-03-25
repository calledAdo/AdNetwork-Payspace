import crypto from "node:crypto";
import OpenAI from "openai";
import { Router, type Request, type Response } from "express";
import { listRecords, readRecord, writeRecord } from "../store.js";
import {
  readAgentBinding,
  sendOwnerChat,
  type AgentBinding,
} from "../orchestration.js";
import { config } from "../config.js";
import type { SellerProfile } from "./publishers.js";
import type { CampaignDetails } from "./campaigns.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { formatAdPositionGuide, formatKeywordFlagGuide } from "../taxonomy.js";

const router = Router();

const assistantClient = config.assistantApiKey
  ? new OpenAI({
      apiKey: config.assistantApiKey,
      baseURL: config.assistantApiBaseUrl,
    })
  : null;

type SubjectType = "seller_profile" | "campaign";
type RouteMode = "auto" | "backend" | "agent";

interface AssistantTurn {
  role: "user" | "assistant";
  source: "frontend" | "backend" | "agent";
  at: string;
  content: string;
}

interface AssistantThread {
  thread_id: string;
  subject_type: SubjectType | null;
  subject_id: string | null;
  created_at: string;
  updated_at: string;
  context?: Record<string, unknown>;
  messages: AssistantTurn[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeThreadId(): string {
  return `asst_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function normalizeSubjectType(value: unknown): SubjectType | null {
  if (value === "seller_profile" || value === "campaign") return value;
  return null;
}

function normalizeRouteMode(value: unknown): RouteMode {
  if (value === "backend" || value === "agent") return value;
  return "auto";
}

function readThread(threadId: string): AssistantThread | null {
  return readRecord<AssistantThread>("assistant_threads", threadId);
}

function writeThread(thread: AssistantThread): void {
  writeRecord("assistant_threads", thread.thread_id, thread);
}

function mergeContext(
  current: Record<string, unknown> | undefined,
  incoming: unknown,
): Record<string, unknown> | undefined {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return current;
  }
  return {
    ...(current ?? {}),
    ...(incoming as Record<string, unknown>),
  };
}

function buildExternalContextFacts(context: Record<string, unknown> | undefined): string[] {
  if (!context || Object.keys(context).length === 0) {
    return ["No additional frontend context was provided."];
  }

  return [
    "Frontend context:",
    JSON.stringify(context),
    "Use wallet-derived fields from frontend context as already-known facts.",
    "Do not ask the user for those fields again unless they explicitly want to override them.",
  ];
}

function resolveContextPublicKey(context: Record<string, unknown> | undefined): string | null {
  if (!context) return null;
  const walletKey = context["wallet_owner_pubkey"];
  if (typeof walletKey === "string" && walletKey.trim()) return walletKey.trim();
  const ownerKey = context["owner_pubkey"];
  if (typeof ownerKey === "string" && ownerKey.trim()) return ownerKey.trim();
  return null;
}

function injectPublicKeyIntoMessage(
  content: string,
  context: Record<string, unknown> | undefined,
): string {
  const publicKey = resolveContextPublicKey(context);
  if (!publicKey) return content;
  if (content.includes(publicKey)) return content;
  return `${content}\n\nThe public_key is ${publicKey}`;
}

function getSellerStatus(ownerPubkey: string): "draft" | "active" | "missing" {
  const seller = readRecord<SellerProfile>("seller_profiles", ownerPubkey);
  if (!seller) return "missing";
  return seller.agent_id && seller.agent_status === "active"
    ? "active"
    : "draft";
}

function getCampaignStatus(campaignId: string): "draft" | "active" | "missing" {
  const campaign = readRecord<CampaignDetails>("campaign_details", campaignId);
  if (!campaign) return "missing";
  return campaign.agent_id && campaign.agent_status === "active"
    ? "active"
    : "draft";
}

function resolveLifecycle(
  subjectType: SubjectType | null,
  subjectId: string | null,
): "draft" | "active" | "missing" {
  if (!subjectType || !subjectId) return "draft";
  if (subjectType === "seller_profile") return getSellerStatus(subjectId);
  return getCampaignStatus(subjectId);
}

function buildSubjectFacts(
  subjectType: SubjectType | null,
  subjectId: string | null,
): string[] {
  if (!subjectType) {
    return [
      "No subject is attached yet.",
      "Your first job is to identify whether the user is onboarding a publisher slot flow or a campaign flow.",
    ];
  }

  if (subjectType === "seller_profile") {
    const seller = subjectId
      ? readRecord<SellerProfile>("seller_profiles", subjectId)
      : null;
    const slotCount = listRecords<Record<string, unknown>>(
      "slot_details",
    ).filter((slot) => subjectId && slot["owner_pubkey"] === subjectId).length;
    return [
      "Subject is a publisher/seller profile.",
      "Required publisher profile fields at onboarding: owner_pubkey, site_url.",
      "owner_pubkey should normally come from the connected wallet in the frontend. Do not ask for it again if it is already available in context.",
      "Do not ask for block_id, agent_id, agent_pubkey, created_at, or updated_at during onboarding. Those are assigned later by the backend/runtime.",
      "Required slot fields for the next slot: snippet_id, page_url, dimensions, min_amount_per_1000, ad_position, publication_mode, keyword_flags, policy_text, metadata.",
      `Infer ad_position using the onboarding convention: ${formatAdPositionGuide()}. If unclear, ask a clarifying question.`,
      `Infer keyword_flags using the 64-bit keyword map. A few seeded examples: ${formatKeywordFlagGuide()}. Multiple keywords can be combined by addition because each value is 2^n.`,
      "Backend submission target for publisher profile: POST /publishers",
      'Publisher profile payload shape: {"owner_pubkey":"0x...","site_url":"https://publisher.example","block_id":"optional-or-null"}',
      "Backend submission target for seller slot: POST /publishers/:ownerPubkey/slots",
      'Seller slot payload shape: {"snippet_id":"optional","page_url":"https://publisher.example/page","dimensions":"728x90","min_amount_per_1000":"1200","ad_position":0,"publication_mode":1,"keyword_flags":"4","policy_text":"No gambling","metadata":{}}',
      `Known seller profile: ${seller ? JSON.stringify(seller) : "not created yet"}.`,
      `Known slot count: ${subjectId ? slotCount : "unknown until publisher exists"}.`,
      "Creating the first confirmed slot will trigger seller-agent spawn and slot sync.",
    ];
  }

  const campaign = subjectId
    ? readRecord<CampaignDetails>("campaign_details", subjectId)
    : null;
  return [
    "Subject is an advertiser campaign.",
    "Campaign onboarding aims to derive campaign_core except for campaign_id, created_at, and updated_at. Those are assigned by the backend on submission.",
    "Required campaign_core fields to collect: owner_pubkey, name, total_budget_udt, max_price_per_mille, keyword_flags, ad_position, creative.image_url, creative.click_url, optional creative.write_up.",
    "owner_pubkey should normally come from the connected wallet in the frontend. Do not ask for it again if it is already available in context.",
    "Do not ask for campaign_id, created_at, updated_at, agent_id, agent_pubkey, or agent_status during onboarding.",
    `Infer ad_position using the onboarding convention: ${formatAdPositionGuide()}. If unclear, ask a clarifying question.`,
    `Infer keyword_flags using the 64-bit keyword map. A few seeded examples: ${formatKeywordFlagGuide()}. Multiple keywords can be combined by addition because each value is 2^n.`,
    "Do not add fields that are not part of campaign_core. For example, campaign duration is not currently a backend campaign_core field unless the schema changes later.",
    "Backend submission target for campaign: POST /campaigns",
    'Campaign payload shape: {"owner_pubkey":"0x...","name":"Campaign Name","total_budget_udt":"5000000","max_price_per_mille":"1500","keyword_flags":"1","ad_position":0,"block_id":"optional-or-null","creative":{"image_url":"https://cdn.example/banner.png","click_url":"https://example.com/landing","write_up":"optional"}}',
    `Known campaign record: ${campaign ? JSON.stringify(campaign) : "not created yet"}.`,
    "Submitting the confirmed campaign_core triggers buyer-agent spawn.",
  ];
}

function onboardingReply(
  subjectType: SubjectType | null,
  subjectId: string | null,
  message: string,
): string {
  if (!subjectType) {
    return [
      "Onboarding assistant mode.",
      "No subject was attached yet, so I can only help collect draft information.",
      `Latest user message: ${message}`,
    ].join(" ");
  }

  if (subjectType === "seller_profile") {
    if (!subjectId) {
      return [
        "Seller onboarding mode.",
        "We are still before publisher creation.",
        "Start by giving me the publisher owner_pubkey and site_url.",
        "After that, I will help derive the first slot payload: snippet_id, page_url, dimensions, min_amount_per_1000, ad_position, publication_mode, keyword_flags, policy_text, and metadata.",
        `Latest user message: ${message}`,
      ].join(" ");
    }

    const seller = readRecord<SellerProfile>("seller_profiles", subjectId);
    if (!seller) {
      return [
        `Seller onboarding for ${subjectId}.`,
        "No saved seller profile exists yet.",
        "Step 1: create the publisher profile with owner_pubkey and site_url.",
        "Step 2: use the assistant to derive slot parameters for a specific page and placement.",
        "Step 3: confirm the slot parameters and submit them through POST /publishers/:ownerPubkey/slots.",
        "Step 4: that first slot submission will spawn the seller agent automatically if it does not exist yet.",
      ].join(" ");
    }

    const slotCount = listRecords<Record<string, unknown>>(
      "slot_details",
    ).filter((slot) => slot["owner_pubkey"] === seller.owner_pubkey).length;

    const nextStep =
      slotCount === 0
        ? "Next step: derive the first slot parameters with the assistant, confirm them, then submit POST /publishers/:ownerPubkey/slots."
        : "Next step: derive another slot's parameters with the assistant, confirm them, then submit POST /publishers/:ownerPubkey/slots.";

    return [
      `Seller onboarding for ${seller.owner_pubkey}.`,
      `Registered slots: ${slotCount}.`,
      `Site URL: ${seller.site_url || "missing"}.`,
      `Seller agent status: ${seller.agent_status}.`,
      "Slot-first workflow:",
      "1. Decide the specific page_url and slot placement to monetize.",
      "2. Derive snippet_id, dimensions, min_amount_per_1000, ad_position, publication_mode, keyword_flags, policy_text, and metadata.",
      "3. Confirm the parameters.",
      "4. Submit the slot. The backend stores slot_details and syncs them to the seller agent.",
      nextStep,
    ].join(" ");
  }

  if (!subjectId) {
    return [
      "Campaign onboarding mode.",
      "We are still before campaign creation.",
      "Start by telling me what you want to advertise, your total budget, max amount per 1000, targeting/keyword flags, preferred ad position, and the creative image and click URLs you already have.",
      "Once those are clear, I will summarize the exact campaign payload to confirm before submission.",
      `Latest user message: ${message}`,
    ].join(" ");
  }

  const campaign = readRecord<CampaignDetails>("campaign_details", subjectId);
  if (!campaign) {
    return [
      `Campaign onboarding for ${subjectId}.`,
      "No saved campaign exists yet.",
      "Collect budget, max CPM, targeting, and creative before submission.",
    ].join(" ");
  }

  return [
    `Campaign onboarding for ${campaign.campaign_core.campaign_id}.`,
    `Budget: ${campaign.campaign_core.total_budget_udt || "missing"}.`,
    `Max CPM: ${campaign.campaign_core.max_price_per_mille || "missing"}.`,
    `Creative image: ${campaign.campaign_core.creative?.image_url ? "present" : "missing"}.`,
    "Step 1: finish collecting campaign targeting and creative.",
    "Step 2: confirm the campaign payload.",
    "Step 3: submit the campaign. The buyer agent is then spawned from campaign_core.",
  ].join(" ");
}

function buildAssistantSystemPrompt(
  subjectType: SubjectType | null,
  subjectId: string | null,
  lifecycle: "draft" | "active" | "missing",
  context: Record<string, unknown> | undefined,
): string {
  return [
    "You are the PaySpace onboarding assistant.",
    "You are a real conversational guide, not a deterministic wizard.",
    "Your goal is to extract the minimum information needed to create either a publisher profile + slot, or a campaign core.",
    "Work through normal chat.",
    "Ask only the single best next question when information is missing.",
    "Do not restate fields that are already known unless the user explicitly asks for a summary or you are doing a final confirmation check.",
    "Do not say 'we'll keep' or repeat stored values in normal turns.",
    "Prefer a short natural question over a long explanation.",
    "Avoid examples unless the user seems confused or asks for them.",
    "Do not dump a long questionnaire unless the user explicitly asks for a checklist.",
    "When enough information is available, summarize the draft payload cleanly and ask for confirmation before submission.",
    "When enough information is available for the current onboarding flow, append a fenced draft block using exactly this format:",
    "```draft",
    '{"draft_type":"campaign_init|seller_profile_init|seller_slot_init","payload":{...}}',
    "```",
    "Only include that draft block when you believe the minimum required fields are complete enough for confirmation.",
    "Do not claim that any profile, slot, or campaign has been created unless the stored state proves it.",
    "Do not fabricate chain state, agent state, wallet state, or backend actions.",
    "Be concrete and operational.",
    "If the user is vague, help them refine the answer rather than guessing hidden values.",
    "For publisher flows, you are also a practical guide. You may recommend sensible snippet dimensions, placement positions, naming patterns for snippet_id, and integration sequencing when the user asks or seems unsure.",
    "Treat backend field names as internal schema, not as user-facing language.",
    "In normal conversation, do not say things like total_budget_udt, max_price_per_mille, keyword_flags, ad_position, publication_mode, or similar internal names.",
    "Instead, ask natural questions like 'What total budget do you want to allocate?' or 'Where should this ad appear on the page?'",
    "Do not use parenthetical schema hints like '(as integer string)' in normal conversation.",
    "Do not include examples unless the user is confused or asks for one.",
    "Use exact field names only in the final draft summary or confirmation payload.",
    `Current lifecycle: ${lifecycle}.`,
    `Current subject type: ${subjectType ?? "none"}.`,
    `Current subject id: ${subjectId ?? "none"}.`,
    "",
    "Conversation rules:",
    "- Keep replies concise.",
    "- Prefer one question at a time.",
    "- Normal turns should usually be 1 to 3 sentences.",
    "- When summarizing a draft, separate 'known' from 'still needed'.",
    "- If enough fields are known, ask explicitly whether to proceed with creation/submission.",
    "- If a field is already known from wallet or thread context, do not ask for it again.",
    "- Ask like a human guide, not like a schema validator.",
    "",
    "Current subject facts:",
    ...buildSubjectFacts(subjectType, subjectId),
    "",
    ...buildExternalContextFacts(context),
  ].join("\n");
}

async function generateBackendAssistantReply(
  thread: AssistantThread,
  subjectType: SubjectType | null,
  subjectId: string | null,
  lifecycle: "draft" | "active" | "missing",
  context: Record<string, unknown> | undefined,
): Promise<string> {
  if (!assistantClient) {
    const latestUserMessage =
      [...thread.messages].reverse().find((message) => message.role === "user")
        ?.content ?? "";
    return onboardingReply(subjectType, subjectId, latestUserMessage);
  }

  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: buildAssistantSystemPrompt(subjectType, subjectId, lifecycle, context),
    },
    ...thread.messages.slice(-12).map((message) => ({
      role: message.role,
      content:
        message.role === "user"
          ? injectPublicKeyIntoMessage(message.content, context)
          : message.content,
    })),
  ];

  const response = await assistantClient.chat.completions.create({
    model: config.assistantModel,
    messages,
  });

  const content = response.choices[0]?.message?.content ?? null;
  if (typeof content === "string" && content.trim()) return content;
  throw new Error("assistant provider returned no message content");
}

async function routeToAgent(
  binding: AgentBinding,
  message: string,
): Promise<string> {
  const upstream = await sendOwnerChat(binding, message);
  const typed = upstream as Record<string, unknown>;
  const choices = Array.isArray(typed["choices"])
    ? (typed["choices"] as Array<Record<string, unknown>>)
    : [];
  const first = choices[0];
  const messageObj = first?.["message"] as Record<string, unknown> | undefined;
  const content = messageObj?.["content"];

  if (typeof content === "string" && content.trim()) return content;
  return JSON.stringify(upstream);
}

router.post("/messages", async (req: Request, res: Response) => {
  const threadId = String(req.body?.thread_id ?? "").trim() || makeThreadId();
  const incomingSubjectType = normalizeSubjectType(req.body?.subject_type);
  const incomingSubjectId =
    typeof req.body?.subject_id === "string" && req.body.subject_id.trim()
      ? req.body.subject_id.trim()
      : null;
  const incomingContext = req.body?.context;
  const message =
    typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const requestedRoute = normalizeRouteMode(req.body?.route_mode);

  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const existing = readThread(threadId);
  const subjectType = incomingSubjectType ?? existing?.subject_type ?? null;
  const subjectId = incomingSubjectId ?? existing?.subject_id ?? null;
  const lifecycle = resolveLifecycle(subjectType, subjectId);
  const binding =
    subjectType && subjectId ? readAgentBinding(subjectType, subjectId) : null;

  // Assistant is onboarding-only. Once a subject is active, auto mode stops
  // behaving like an assistant and simply routes owner messages to the agent.
  const resolvedRoute: Exclude<RouteMode, "auto"> =
    requestedRoute === "backend"
      ? "backend"
      : requestedRoute === "agent"
        ? "agent"
        : lifecycle === "active"
          ? "agent"
          : "backend";

  if (resolvedRoute === "agent" && (!binding || binding.status !== "active")) {
    res
      .status(404)
      .json({ error: "no active agent binding found for agent route" });
    return;
  }

  if (
    resolvedRoute === "backend" &&
    lifecycle === "active" &&
    requestedRoute !== "backend"
  ) {
    res.status(409).json({
      error:
        "subject is already active; onboarding assistant mode is closed and messages should route to the bound agent",
    });
    return;
  }

  const thread: AssistantThread = existing ?? {
    thread_id: threadId,
    subject_type: subjectType,
    subject_id: subjectId,
    created_at: nowIso(),
    updated_at: nowIso(),
    context: undefined,
    messages: [],
  };

  thread.subject_type = subjectType;
  thread.subject_id = subjectId;
  thread.context = mergeContext(thread.context, incomingContext);
  thread.messages.push({
    role: "user",
    source: "frontend",
    at: nowIso(),
    content: message,
  });

  let reply = "";
  let source: AssistantTurn["source"] = "backend";

  if (resolvedRoute === "agent" && binding) {
    reply = await routeToAgent(binding, message);
    source = "agent";
  } else {
    try {
      reply = await generateBackendAssistantReply(
        thread,
        subjectType,
        subjectId,
        lifecycle,
        thread.context,
      );
    } catch (err) {
      console.error("[assistant] backend LLM failed, falling back:", err);
      reply = onboardingReply(subjectType, subjectId, message);
    }
    source = "backend";
  }

  thread.messages.push({
    role: "assistant",
    source,
    at: nowIso(),
    content: reply,
  });
  thread.updated_at = nowIso();
  writeThread(thread);

  res.json({
    thread_id: thread.thread_id,
    subject_type: thread.subject_type,
    subject_id: thread.subject_id,
    lifecycle,
    route_mode: resolvedRoute,
    response_source: source,
    reply,
  });
});

router.get("/threads/:id", (req: Request, res: Response) => {
  const thread = readThread(String(req.params.id ?? ""));
  if (!thread) {
    res.status(404).json({ error: "assistant thread not found" });
    return;
  }
  res.json(thread);
});

export default router;
