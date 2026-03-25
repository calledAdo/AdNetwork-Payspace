/**
 * Identifies the built-in gateway templates that can be spawned on demand.
 */
export type AgentType = "buyer" | "seller" | "test_agent_a" | "test_agent_b";

/**
 * Represents one agent currently known to the gateway and routable by id.
 */
export interface AgentEntry {
  agentId: string;
  agentType: AgentType;
  agentDir: string;
  pubkey: string;
  blake160: string;
  a2aUrl: string;
  card: AgentCard;
  spawnedAt: Date;
}

/**
 * Captures the public metadata the gateway serves for each agent.
 */
export interface AgentCard {
  name: string;
  description: string;
  url: string;
  pubkey: string;
  provider: { organization: string; url: string };
  version: string;
  capabilities: { streaming: boolean; pushNotifications: boolean };
  authentication: { schemes: string[] };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentCardSkill[];
}

/**
 * Describes a single advertised capability from an agent card.
 */
export interface AgentCardSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

// In-memory routing table: agentId → AgentEntry.
/**
 * Keeps the gateway's live routing view in memory so request handlers can map
 * agent ids to workspace paths and identity metadata quickly.
 */
class AgentRegistry {
  private entries = new Map<string, AgentEntry>();

  /**
   * Adds or replaces a registry entry for an agent id.
   */
  register(entry: AgentEntry): void {
    this.entries.set(entry.agentId, entry);
  }

  /**
   * Returns the registry entry for a specific agent id.
   */
  get(agentId: string): AgentEntry | undefined {
    return this.entries.get(agentId);
  }

  /**
   * Removes an agent from the routing table.
   */
  remove(agentId: string): boolean {
    return this.entries.delete(agentId);
  }

  /**
   * Lists all registered agents in insertion order.
   */
  list(): AgentEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Finds an agent by its on-chain blake160 identifier.
   */
  getByBlake160(blake160: string): AgentEntry | undefined {
    return [...this.entries.values()].find((e) => e.blake160 === blake160);
  }
}

// Singleton — import this in routes and spawner.
let _registry: AgentRegistry | null = null;

/**
 * Returns the shared registry instance used across the gateway process.
 */
export function getRegistry(): AgentRegistry {
  if (!_registry) _registry = new AgentRegistry();
  return _registry;
}
