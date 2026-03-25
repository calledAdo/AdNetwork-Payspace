// Publisher (seller) routes.
//
// One publisher profile is keyed by `owner_pubkey`, which represents the human
// publisher account. Slot configuration lives separately in `slot_details`.

import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import {
  deleteRecord,
  listRecords,
  readRecord,
  writeRecord,
} from "../store.js";
import {
  fetchAgentConversation,
  fetchAgentConversations,
  fetchAgentMetrics,
  markBindingTerminated,
  readAgentBinding,
  selectGatewayNode,
  sendOwnerChat,
  sendOwnerCommand,
  spawnAgentOnGateway,
  terminateAgentOnGateway,
  type AgentBinding,
  writeAgentBinding,
} from "../orchestration.js";

const router = Router();

export interface SellerProfile {
  owner_pubkey: string;
  site_url: string;
  block_id: string | null;
  agent_id: string | null;
  agent_pubkey: string | null;
  agent_status: "none" | "pending" | "active" | "error";
  created_at: string;
  updated_at: string;
}

export interface SellerProfileInit {
  owner_pubkey: string;
  site_url: string;
}

export interface SellerSlotInit {
  snippet_id?: string;
  page_url?: string | null;
  dimensions?: string | null;
  min_amount_per_1000?: string;
  ad_position?: number;
  publication_mode?: number;
  keyword_flags?: string;
  policy_text?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SellerSlotDetails {
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
}

function nowIso(): string {
  return new Date().toISOString();
}

function getActiveSellerBinding(ownerPubkey: string): AgentBinding | null {
  const binding = readAgentBinding("seller_profile", ownerPubkey);
  return binding && binding.status === "active" ? binding : null;
}

function makeSnippetId(): string {
  return `snip_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function normalizeSlotDetails(slot: SellerSlotDetails): SellerSlotDetails {
  return {
    ...slot,
    installation: slot.installation ?? { status: "awaiting_install" },
  };
}

function buildTrackingUrl(
  pathname: string,
  params: Record<string, string | null>,
): string {
  const url = new URL(pathname, config.trackingUrl);
  for (const [key, value] of Object.entries(params)) {
    if (!value) continue;
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function buildEmbedHtml(snippetId: string): string {
  const loaderUrl = buildTrackingUrl("/tracking/snippet/loader.js", {
    id: snippetId,
  });
  return [
    `<div id="${snippetId}"></div>`,
    `<script async src="${loaderUrl}" crossorigin="anonymous"></script>`,
  ].join("\n");
}

function listSlotDetails(ownerPubkey: string): SellerSlotDetails[] {
  return listRecords<SellerSlotDetails>("slot_details")
    .filter((slot) => slot.owner_pubkey === ownerPubkey)
    .map(normalizeSlotDetails)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function seedSnippetContent(snippetId: string): void {
  if (readRecord("snippet_content", snippetId)) return;
  writeRecord("snippet_content", snippetId, {
    schema_version: 1,
    snippet_id: snippetId,
    version: 0,
    status: "inactive",
    image_url: null,
    action_url: null,
    write_up: null,
    updated_at: nowIso(),
  });
}

function createSellerSlotDetails(
  ownerPubkey: string,
  body: SellerSlotInit,
): SellerSlotDetails {
  const snippetId = body.snippet_id?.trim() || makeSnippetId();
  const existingRaw = readRecord<SellerSlotDetails>("slot_details", snippetId);
  const existing = existingRaw ? normalizeSlotDetails(existingRaw) : null;
  const slot: SellerSlotDetails = {
    schema_version: 1,
    snippet_id: snippetId,
    owner_pubkey: ownerPubkey,
    page_url: body.page_url?.trim() || null,
    dimensions: body.dimensions?.trim() || null,
    min_amount_per_1000:
      body.min_amount_per_1000?.trim() || existing?.min_amount_per_1000 || "0",
    ad_position: body.ad_position ?? existing?.ad_position ?? 0,
    publication_mode: body.publication_mode ?? existing?.publication_mode ?? 1,
    keyword_flags: body.keyword_flags?.trim() || existing?.keyword_flags || "0",
    policy_text: body.policy_text?.trim() || existing?.policy_text || null,
    metadata: body.metadata ?? existing?.metadata ?? null,
    installation: {
      status: existing?.installation.status ?? "awaiting_install",
    },
    created_at: existing?.created_at ?? nowIso(),
  };
  writeRecord("slot_details", snippetId, slot);
  seedSnippetContent(snippetId);
  return slot;
}

async function spawnSellerAgent(profile: SellerProfile): Promise<{
  binding: AgentBinding;
  agent_id: string;
  agent_pubkey: string;
}> {
  const node = selectGatewayNode(profile.block_id);

  const agent = await spawnAgentOnGateway(node, {
    type: "seller",
    initConfig: {
      ownerPubkey: profile.owner_pubkey,
      siteUrl: profile.site_url,
    },
  });

  const binding: AgentBinding = {
    subject_type: "seller_profile",
    subject_id: profile.owner_pubkey,
    agent_type: "seller",
    block_id: node.block_id,
    gateway_url: node.gateway_url,
    agent_id: agent.agentId,
    agent_pubkey: agent.pubkey,
    blake160: agent.blake160,
    a2a_url: agent.a2aUrl,
    status: "active",
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  writeAgentBinding(binding);

  return {
    binding,
    agent_id: agent.agentId,
    agent_pubkey: agent.pubkey,
  };
}

async function syncSlotsToAgent(
  binding: AgentBinding,
  ownerPubkey: string,
): Promise<void> {
  const slots = listSlotDetails(ownerPubkey);
  for (const slot of slots) {
    await sendOwnerCommand(binding, "register_slot", slot);
  }
}

async function ensureSellerAgent(profile: SellerProfile): Promise<{
  profile: SellerProfile;
  binding: AgentBinding;
}> {
  const existing = readAgentBinding("seller_profile", profile.owner_pubkey);
  if (existing && existing.status === "active") {
    const refreshedProfile: SellerProfile = {
      ...profile,
      agent_id: existing.agent_id,
      agent_pubkey: existing.agent_pubkey,

      agent_status: "active",
      updated_at: nowIso(),
    };
    writeRecord("seller_profiles", profile.owner_pubkey, refreshedProfile);
    return { profile: refreshedProfile, binding: existing };
  }

  const pendingProfile: SellerProfile = {
    ...profile,
    agent_status: "pending",
    updated_at: nowIso(),
  };
  writeRecord("seller_profiles", profile.owner_pubkey, pendingProfile);

  const spawned = await spawnSellerAgent(profile);
  const activeProfile: SellerProfile = {
    ...profile,
    block_id: spawned.binding.block_id,
    agent_id: spawned.agent_id,
    agent_pubkey: spawned.agent_pubkey,
    agent_status: "active",
    updated_at: nowIso(),
  };
  writeRecord("seller_profiles", profile.owner_pubkey, activeProfile);
  await syncSlotsToAgent(spawned.binding, profile.owner_pubkey);
  return { profile: activeProfile, binding: spawned.binding };
}

router.post("/", (req: Request, res: Response) => {
  const {
    owner_pubkey = "",
    site_url = "",
    block_id = null,
  } = req.body as Partial<SellerProfileInit> & { block_id?: string | null };

  if (!owner_pubkey.trim()) {
    res.status(400).json({ error: "owner_pubkey is required" });
    return;
  }

  const profile: SellerProfile = {
    owner_pubkey: owner_pubkey.trim(),
    site_url: site_url.trim(),
    block_id,
    agent_id: null,
    agent_pubkey: null,
    agent_status: "none",
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  writeRecord("seller_profiles", profile.owner_pubkey, profile);
  res.status(201).json(profile);
});

router.get("/", (_req: Request, res: Response) => {
  const sellers = listRecords<SellerProfile>("seller_profiles");
  res.json({ total: sellers.length, sellers });
});

router.get("/:ownerPubkey", (req: Request, res: Response) => {
  const ownerPubkey = String(req.params.ownerPubkey ?? "");
  const profile = readRecord<SellerProfile>("seller_profiles", ownerPubkey);
  if (!profile) {
    res.status(404).json({ error: "seller profile not found" });
    return;
  }

  res.json({
    ...profile,
    slot_count: listSlotDetails(ownerPubkey).length,
    agent_binding: readAgentBinding("seller_profile", ownerPubkey),
  });
});

router.get("/:ownerPubkey/slots", (req: Request, res: Response) => {
  const ownerPubkey = String(req.params.ownerPubkey ?? "");
  const profile = readRecord<SellerProfile>("seller_profiles", ownerPubkey);
  if (!profile) {
    res.status(404).json({ error: "seller profile not found" });
    return;
  }

  const slots = listSlotDetails(ownerPubkey);
  res.json({ owner_pubkey: ownerPubkey, total: slots.length, slots });
});

router.post("/:ownerPubkey/slots", async (req: Request, res: Response) => {
  const ownerPubkey = String(req.params.ownerPubkey ?? "");
  const profile = readRecord<SellerProfile>("seller_profiles", ownerPubkey);
  if (!profile) {
    res.status(404).json({ error: "seller profile not found" });
    return;
  }

  const slot = createSellerSlotDetails(ownerPubkey, {
    snippet_id:
      typeof req.body?.snippet_id === "string"
        ? req.body.snippet_id
        : undefined,
    page_url:
      typeof req.body?.page_url === "string" ? req.body.page_url : undefined,
    dimensions:
      typeof req.body?.dimensions === "string"
        ? req.body.dimensions
        : undefined,
    min_amount_per_1000:
      typeof req.body?.min_amount_per_1000 === "string"
        ? req.body.min_amount_per_1000
        : undefined,
    ad_position:
      typeof req.body?.ad_position === "number"
        ? req.body.ad_position
        : undefined,
    publication_mode:
      typeof req.body?.publication_mode === "number"
        ? req.body.publication_mode
        : undefined,
    keyword_flags:
      typeof req.body?.keyword_flags === "string"
        ? req.body.keyword_flags
        : undefined,
    policy_text:
      typeof req.body?.policy_text === "string"
        ? req.body.policy_text
        : undefined,
    metadata:
      req.body?.metadata &&
      typeof req.body.metadata === "object" &&
      !Array.isArray(req.body.metadata)
        ? (req.body.metadata as Record<string, unknown>)
        : null,
  });

  try {
    const ensured = await ensureSellerAgent(profile);
    const commandResult = await sendOwnerCommand(
      ensured.binding,
      "register_slot",
      slot,
    );
    res.status(201).json({
      slot,
      install: {
        snippet_id: slot.snippet_id,
        loader_url: buildTrackingUrl("/tracking/snippet/loader.js", {
          id: slot.snippet_id,
        }),
        embed_html: buildEmbedHtml(slot.snippet_id),
        status: slot.installation.status,
      },
      agent_status: ensured.profile.agent_status,
      command_result: commandResult,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeRecord("seller_profiles", ownerPubkey, {
      ...profile,
      agent_status: "error",
      updated_at: nowIso(),
    });
    res.status(502).json({
      error: message,
      slot,
    });
  }
});

router.get("/:ownerPubkey/metrics", async (req: Request, res: Response) => {
  const ownerPubkey = String(req.params.ownerPubkey ?? "");
  const binding = getActiveSellerBinding(ownerPubkey);
  if (!binding) {
    res.status(404).json({ error: "active seller agent binding not found" });
    return;
  }

  try {
    res.json(await fetchAgentMetrics(binding));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: message });
  }
});

router.get("/:ownerPubkey/conversations", async (req: Request, res: Response) => {
  const ownerPubkey = String(req.params.ownerPubkey ?? "");
  const binding = getActiveSellerBinding(ownerPubkey);
  if (!binding) {
    res.status(404).json({ error: "active seller agent binding not found" });
    return;
  }

  try {
    res.json(await fetchAgentConversations(binding));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: message });
  }
});

router.get(
  "/:ownerPubkey/conversations/:contextId",
  async (req: Request, res: Response) => {
    const ownerPubkey = String(req.params.ownerPubkey ?? "");
    const binding = getActiveSellerBinding(ownerPubkey);
    if (!binding) {
      res.status(404).json({ error: "active seller agent binding not found" });
      return;
    }

    try {
      res.json(
        await fetchAgentConversation(binding, String(req.params.contextId ?? "")),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("(404)") ? 404 : 502;
      res.status(status).json({ error: message });
    }
  },
);

router.post("/:ownerPubkey/chat", async (req: Request, res: Response) => {
  const ownerPubkey = String(req.params.ownerPubkey ?? "");
  const binding = getActiveSellerBinding(ownerPubkey);
  if (!binding) {
    res.status(404).json({ error: "active seller agent binding not found" });
    return;
  }

  const message = String(req.body?.message ?? "");
  try {
    res.json(await sendOwnerChat(binding, message));
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: messageText });
  }
});

router.post("/:ownerPubkey/agent", async (req: Request, res: Response) => {
  const ownerPubkey = String(req.params.ownerPubkey ?? "");
  const profile = readRecord<SellerProfile>("seller_profiles", ownerPubkey);
  if (!profile) {
    res.status(404).json({ error: "seller profile not found" });
    return;
  }

  const currentBinding = readAgentBinding("seller_profile", ownerPubkey);
  if (currentBinding && currentBinding.status === "active") {
    try {
      await terminateAgentOnGateway(currentBinding);
    } catch {
      // best effort
    }
    markBindingTerminated("seller_profile", ownerPubkey);
  }

  const pendingProfile: SellerProfile = {
    ...profile,
    agent_status: "pending",
    updated_at: nowIso(),
  };
  writeRecord("seller_profiles", ownerPubkey, pendingProfile);

  res.json({
    owner_pubkey: ownerPubkey,
    agent_status: "pending",
    message: "spawning seller agent…",
  });

  try {
    const spawned = await spawnSellerAgent(profile);
    const activeProfile: SellerProfile = {
      ...profile,
      block_id: spawned.binding.block_id,
      agent_id: spawned.agent_id,
      agent_pubkey: spawned.agent_pubkey,
      agent_status: "active",
      updated_at: nowIso(),
    };
    writeRecord("seller_profiles", ownerPubkey, activeProfile);
    await syncSlotsToAgent(spawned.binding, ownerPubkey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeRecord("seller_profiles", ownerPubkey, {
      ...profile,
      agent_status: "error",
      updated_at: nowIso(),
    });
    console.error(
      `[publishers] seller agent respawn failed for ${ownerPubkey}:`,
      message,
    );
  }
});

router.delete("/:ownerPubkey", async (req: Request, res: Response) => {
  const ownerPubkey = String(req.params.ownerPubkey ?? "");
  const profile = readRecord<SellerProfile>("seller_profiles", ownerPubkey);
  if (!profile) {
    res.status(404).json({ error: "seller profile not found" });
    return;
  }

  const binding = readAgentBinding("seller_profile", ownerPubkey);
  if (binding && binding.status === "active") {
    try {
      await terminateAgentOnGateway(binding);
    } catch {
      // best effort
    }
    markBindingTerminated("seller_profile", ownerPubkey);
  }

  deleteRecord("seller_profiles", ownerPubkey);
  res.json({ deleted: true, owner_pubkey: ownerPubkey });
});

export default router;
