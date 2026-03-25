import { config } from "./config.js";
import { listRecords, readRecord, writeRecord } from "./store.js";

export interface GatewayNode {
  block_id: string;
  gateway_url: string;
  gateway_api_key: string;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
}

export interface AgentBinding {
  subject_type: "seller_profile" | "campaign";
  subject_id: string;
  agent_type: "seller" | "buyer";
  block_id: string;
  gateway_url: string;
  agent_id: string;
  agent_pubkey: string;
  blake160: string;
  a2a_url: string;
  status: "active" | "terminated" | "error";
  created_at: string;
  updated_at: string;
}

export interface SpawnedAgent {
  agentId: string;
  pubkey: string;
  blake160: string;
  a2aUrl: string;
}

async function fetchAgentRoute(
  binding: AgentBinding,
  suffix: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${binding.gateway_url}/agents/${binding.agent_id}${suffix}`, init);
}

function bindingId(subjectType: AgentBinding["subject_type"], subjectId: string): string {
  return `${subjectType}:${subjectId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function listGatewayNodes(): GatewayNode[] {
  const nodes = listRecords<GatewayNode>("gateway_nodes");
  if (nodes.length > 0) return nodes;

  // Backward-compatible fallback for local/dev setups that only configure one
  // gateway in env rather than persisting gateway nodes in the store.
  return [{
    block_id: "default",
    gateway_url: config.blockPublicUrl,
    gateway_api_key: config.blockApiKey,
    status: "active",
    created_at: nowIso(),
    updated_at: nowIso(),
  }];
}

export function selectGatewayNode(preferredBlockId?: string | null): GatewayNode {
  const nodes = listGatewayNodes();

  if (preferredBlockId) {
    const exact = nodes.find((node) => node.block_id === preferredBlockId && node.status === "active");
    if (exact) return exact;
  }

  const firstActive = nodes.find((node) => node.status === "active");
  if (!firstActive) throw new Error("no active gateway node available");
  return firstActive;
}

export async function spawnAgentOnGateway(
  node: GatewayNode,
  body: { type: "seller" | "buyer"; initConfig: Record<string, unknown> },
): Promise<SpawnedAgent> {
  const res = await fetch(`${node.gateway_url}/agents/spawn`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(node.gateway_api_key ? { Authorization: `Bearer ${node.gateway_api_key}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`gateway spawn failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<SpawnedAgent>;
}

export async function terminateAgentOnGateway(binding: AgentBinding): Promise<void> {
  await fetch(`${binding.gateway_url}/agents/${binding.agent_id}`, {
    method: "DELETE",
  });
}

export async function fetchAgentMetrics(binding: AgentBinding): Promise<unknown> {
  const res = await fetchAgentRoute(binding, "/metrics");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`gateway metrics failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function fetchAgentConversations(binding: AgentBinding): Promise<unknown> {
  const res = await fetchAgentRoute(binding, "/conversations");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`gateway conversations failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function fetchAgentConversation(
  binding: AgentBinding,
  contextId: string,
): Promise<unknown> {
  const res = await fetchAgentRoute(
    binding,
    `/conversations/${encodeURIComponent(contextId)}`,
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`gateway conversation failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function sendOwnerChat(binding: AgentBinding, message: string): Promise<unknown> {
  const res = await fetchAgentRoute(binding, "/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  return res.json();
}

export async function sendOwnerCommand(
  binding: AgentBinding,
  command: string,
  params?: unknown,
): Promise<unknown> {
  const res = await fetchAgentRoute(binding, "/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, params }),
  });
  return res.json();
}

export function readAgentBinding(
  subjectType: AgentBinding["subject_type"],
  subjectId: string,
): AgentBinding | null {
  return readRecord<AgentBinding>("agent_bindings", bindingId(subjectType, subjectId));
}

export function writeAgentBinding(binding: AgentBinding): void {
  writeRecord("agent_bindings", bindingId(binding.subject_type, binding.subject_id), binding);
}

export function markBindingTerminated(
  subjectType: AgentBinding["subject_type"],
  subjectId: string,
): void {
  const current = readAgentBinding(subjectType, subjectId);
  if (!current) return;
  writeAgentBinding({
    ...current,
    status: "terminated",
    updated_at: nowIso(),
  });
}
