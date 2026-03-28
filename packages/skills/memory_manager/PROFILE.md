# Profile: memory_manager

## Scope

`memory_manager` is the shared local-state helper skill. It provides
schema-aware helpers for creating and mutating workspace memory.

Implementation is **role-specific**:

- **Seller**: grouped slot records in `memory/slots.json`, seller `stats.json`, plus shared dirs (conversations, reports, tickets).
- **Buyer**: grouped placement records in `memory/placements.json`, buyer `stats.json`, and the same shared layout patterns.
- **Conversations**: per-context JSON under `memory/conversations/` (append helper ships with buyer schema import; same `ConversationLogSchema` shape as seller schema module).

## Type

`capability` — agent-local state management.

## Dependencies

### Skills

None.

### NPM Packages

- `zod` — runtime schema validation for memory files

### MCP Servers

None — this skill operates entirely on the local filesystem.

### External Services

None.

## Compatibility

`memory_manager` is a local capability. It is not required on counterparties.
Any agent that needs structured, schema-validated local persistence should
declare this skill.

## Assumptions

- `AGENT_DIR` is set in the environment; scripts resolve it through [`packages/skills/config.js`](../config.js) (`skillsConfig.agentDir`), matching other skills in this package.
- Memory files are local JSON (or empty `.jsonl` for suspicious message log) inside that workspace.
- Writes are atomic (temp file + rename).
- You use the **buyer** or **seller** `ensure_memory_state_*` and matching upsert script for your workspace role.

## Best Practices

- initialize memory before business workflows run
- use the provided mutation helpers instead of ad-hoc JSON writes
- treat schema validation failures as hard errors
