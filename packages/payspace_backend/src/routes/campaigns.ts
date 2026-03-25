// Campaign routes.
//
// Persistent campaign records are split into:
// - `campaign_core`: business data known before agent spawn
// - outer campaign details: operational metadata such as block selection,
//   agent identity, and lifecycle state

import { Router, type Request, type Response } from "express";
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

export interface Creative {
  image_url: string;
  click_url: string;
  write_up?: string;
}

export interface CampaignInit {
  owner_pubkey: string;
  name: string;
  total_budget_udt: string;
  max_price_per_mille: string;
  keyword_flags: string;
  ad_position: number;
  creative: Creative;
}

export interface CampaignCore {
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
}

export type CampaignStatus =
  | "pending"
  | "active"
  | "paused"
  | "completed"
  | "error";

export interface CampaignDetails {
  campaign_core: CampaignCore;
  block_id: string | null;
  agent_id: string | null;
  agent_pubkey: string | null;
  agent_status: "none" | "pending" | "active" | "error";
  status: CampaignStatus;
}

function nowIso(): string {
  return new Date().toISOString();
}

function getActiveCampaignBinding(campaignId: string): AgentBinding | null {
  const binding = readAgentBinding("campaign", campaignId);
  return binding && binding.status === "active" ? binding : null;
}

async function spawnBuyerAgent(
  campaign: CampaignDetails,
  preferredBlockId?: string | null,
): Promise<{
  binding: AgentBinding;
  agent_id: string;
  agent_pubkey: string;
}> {
  const node = selectGatewayNode(preferredBlockId ?? campaign.block_id);
  const core = campaign.campaign_core;

  const initConfig = {
    campaignId: core.campaign_id,
    ownerPubkey: core.owner_pubkey,
    totalBudgetUdt: core.total_budget_udt,
    maxPricePerMille: core.max_price_per_mille,
    keywordFlags: core.keyword_flags,
    adPosition: core.ad_position,
    creative: core.creative,
  };

  const agent = await spawnAgentOnGateway(node, {
    type: "buyer",
    initConfig,
  });

  const binding: AgentBinding = {
    subject_type: "campaign",
    subject_id: core.campaign_id,
    agent_type: "buyer",
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

router.post("/", async (req: Request, res: Response) => {
  const {
    owner_pubkey = "",
    name = "",
    total_budget_udt = "0",
    max_price_per_mille = "0",
    keyword_flags = "1",
    ad_position = 0,
    block_id = null,
    creative = { image_url: "", click_url: "" },
  } = req.body as Partial<CampaignInit> & { block_id?: string | null };

  if (!owner_pubkey.trim()) {
    res.status(400).json({ error: "owner_pubkey is required" });
    return;
  }

  const createdAt = nowIso();
  const campaignCore: CampaignCore = {
    campaign_id: `camp_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    owner_pubkey: owner_pubkey.trim(),
    name,
    total_budget_udt,
    max_price_per_mille,
    keyword_flags,
    ad_position,
    creative,
    created_at: createdAt,
    updated_at: createdAt,
  };

  const campaign: CampaignDetails = {
    campaign_core: campaignCore,
    block_id,
    agent_id: null,
    agent_pubkey: null,
    agent_status: "pending",
    status: "pending",
  };

  writeRecord("campaign_details", campaignCore.campaign_id, campaign);
  res.status(201).json({
    campaign_id: campaignCore.campaign_id,
    agent_status: "pending",
    message: "spawning buyer agent…",
  });

  try {
    const spawned = await spawnBuyerAgent(campaign, block_id);
    writeRecord("campaign_details", campaignCore.campaign_id, {
      ...campaign,
      block_id: spawned.binding.block_id,
      agent_id: spawned.agent_id,
      agent_pubkey: spawned.agent_pubkey,
      agent_status: "active" as const,
      status: "active" as CampaignStatus,
      updated_at: nowIso(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeRecord("campaign_details", campaignCore.campaign_id, {
      ...campaign,
      agent_status: "error" as const,
      status: "error" as CampaignStatus,
      updated_at: nowIso(),
    });
    console.error(
      `[campaigns] buyer agent spawn failed for ${campaignCore.campaign_id}:`,
      message,
    );
  }
});

router.get("/", (req: Request, res: Response) => {
  let campaigns = listRecords<CampaignDetails>("campaign_details");
  const ownerPubkey = String(req.query?.owner_pubkey ?? "");
  const status = String(req.query?.status ?? "");
  if (ownerPubkey) {
    campaigns = campaigns.filter(
      (campaign) => campaign.campaign_core.owner_pubkey === ownerPubkey,
    );
  }
  if (status) {
    campaigns = campaigns.filter((campaign) => campaign.status === status);
  }
  res.json({ total: campaigns.length, campaigns });
});

router.get("/:id", (req: Request, res: Response) => {
  const campaign = readRecord<CampaignDetails>(
    "campaign_details",
    String(req.params.id ?? ""),
  );
  if (!campaign) {
    res.status(404).json({ error: "campaign not found" });
    return;
  }

  res.json({
    ...campaign,
    agent_binding: readAgentBinding(
      "campaign",
      campaign.campaign_core.campaign_id,
    ),
  });
});

router.get("/:id/metrics", async (req: Request, res: Response) => {
  const binding = getActiveCampaignBinding(String(req.params.id ?? ""));
  if (!binding) {
    res.status(404).json({ error: "active buyer agent binding not found" });
    return;
  }

  try {
    res.json(await fetchAgentMetrics(binding));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: message });
  }
});

router.get("/:id/conversations", async (req: Request, res: Response) => {
  const binding = getActiveCampaignBinding(String(req.params.id ?? ""));
  if (!binding) {
    res.status(404).json({ error: "active buyer agent binding not found" });
    return;
  }

  try {
    res.json(await fetchAgentConversations(binding));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: message });
  }
});

router.get("/:id/conversations/:contextId", async (req: Request, res: Response) => {
  const binding = getActiveCampaignBinding(String(req.params.id ?? ""));
  if (!binding) {
    res.status(404).json({ error: "active buyer agent binding not found" });
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
});

router.patch("/:id", async (req: Request, res: Response) => {
  const campaign = readRecord<CampaignDetails>(
    "campaign_details",
    String(req.params.id ?? ""),
  );
  if (!campaign) {
    res.status(404).json({ error: "campaign not found" });
    return;
  }

  const { name, max_price_per_mille, keyword_flags, creative, status } =
    req.body as Partial<{
      name: string;
      max_price_per_mille: string;
      keyword_flags: string;
      creative: Creative;
      status: CampaignStatus;
    }>;

  const updatedCore: CampaignCore = {
    ...campaign.campaign_core,
    ...(name && { name }),
    ...(max_price_per_mille && { max_price_per_mille }),
    ...(keyword_flags && { keyword_flags }),
    ...(creative && {
      creative: { ...campaign.campaign_core.creative, ...creative },
    }),
    updated_at: nowIso(),
  };

  const updated: CampaignDetails = {
    ...campaign,
    campaign_core: updatedCore,
    ...(status && { status }),
  };

  writeRecord("campaign_details", campaign.campaign_core.campaign_id, updated);

  const binding = readAgentBinding(
    "campaign",
    campaign.campaign_core.campaign_id,
  );
  if (binding && binding.status === "active") {
    void sendOwnerCommand(binding, "update_settings", {
      max_price_per_mille,
      keyword_flags,
      creative,
      status,
    }).catch(() => undefined);
  }

  res.json(updated);
});

router.post("/:id/chat", async (req: Request, res: Response) => {
  const binding = getActiveCampaignBinding(String(req.params.id ?? ""));
  if (!binding) {
    res.status(404).json({ error: "active buyer agent binding not found" });
    return;
  }

  try {
    res.json(await sendOwnerChat(binding, String(req.body?.message ?? "")));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: message });
  }
});

router.post("/:id/command", async (req: Request, res: Response) => {
  const binding = getActiveCampaignBinding(String(req.params.id ?? ""));
  if (!binding) {
    res.status(404).json({ error: "active buyer agent binding not found" });
    return;
  }

  const command = String(req.body?.command ?? "");
  try {
    res.json(await sendOwnerCommand(binding, command, req.body?.params));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: message });
  }
});

router.post("/:id/agent", async (req: Request, res: Response) => {
  const campaign = readRecord<CampaignDetails>(
    "campaign_details",
    String(req.params.id ?? ""),
  );
  if (!campaign) {
    res.status(404).json({ error: "campaign not found" });
    return;
  }

  const currentBinding = readAgentBinding(
    "campaign",
    campaign.campaign_core.campaign_id,
  );
  if (currentBinding && currentBinding.status === "active") {
    try {
      await terminateAgentOnGateway(currentBinding);
    } catch {
      // best effort
    }
    markBindingTerminated("campaign", campaign.campaign_core.campaign_id);
  }

  const pending: CampaignDetails = {
    ...campaign,
    agent_status: "pending",
  };
  writeRecord("campaign_details", campaign.campaign_core.campaign_id, pending);

  res.json({
    campaign_id: campaign.campaign_core.campaign_id,
    agent_status: "pending",
    message: "spawning buyer agent…",
  });

  try {
    const preferredBlockId =
      typeof req.body?.block_id === "string" && req.body.block_id.trim()
        ? req.body.block_id.trim()
        : campaign.block_id;
    const spawned = await spawnBuyerAgent(campaign, preferredBlockId);
    writeRecord("campaign_details", campaign.campaign_core.campaign_id, {
      ...campaign,
      block_id: spawned.binding.block_id,
      agent_id: spawned.agent_id,
      agent_pubkey: spawned.agent_pubkey,
      agent_status: "active" as const,
      status: "active" as CampaignStatus,
      updated_at: nowIso(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeRecord("campaign_details", campaign.campaign_core.campaign_id, {
      ...campaign,
      agent_status: "error" as const,
      status: "error" as CampaignStatus,
      updated_at: nowIso(),
    });
    console.error(
      `[campaigns] buyer agent respawn failed for ${campaign.campaign_core.campaign_id}:`,
      message,
    );
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  const campaign = readRecord<CampaignDetails>(
    "campaign_details",
    String(req.params.id ?? ""),
  );
  if (!campaign) {
    res.status(404).json({ error: "campaign not found" });
    return;
  }

  const binding = readAgentBinding(
    "campaign",
    campaign.campaign_core.campaign_id,
  );
  if (binding && binding.status === "active") {
    try {
      await terminateAgentOnGateway(binding);
    } catch {
      // best effort
    }
    markBindingTerminated("campaign", campaign.campaign_core.campaign_id);
  }

  deleteRecord("campaign_details", campaign.campaign_core.campaign_id);
  res.json({ deleted: true, campaign_id: campaign.campaign_core.campaign_id });
});

export default router;
