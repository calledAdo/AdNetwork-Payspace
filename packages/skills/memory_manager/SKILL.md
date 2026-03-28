---
name: memory_manager
description: Shared workspace state layout, schema validation, and atomic persistence helpers.
---

# Skill: memory_manager

This skill owns workspace local memory structure and mutation helpers. Entrypoints are **role-specific** (buyer vs seller); run the scripts that match your workspace template.

## Possible Tasks

- initialize workspace memory directories and baseline files (buyer or seller)
- validate memory files against Zod schemas (via the schema modules imported by scripts)
- atomically upsert a **seller** slot record in `memory/slots.json`
- atomically upsert a **buyer** placement record in `memory/placements.json`
- append an event to `memory/conversations/{contextId}.json` (buyer-oriented helper)

## Scripts

All scripts read **`AGENT_DIR`** via [`packages/skills/config.js`](../config.js) (`skillsConfig.agentDir`). Set `AGENT_DIR` in the environment before running.

### Seller

- `scripts/ensure_memory_state_seller.mjs`  
  Creates required memory directories and baseline files if they do not exist (slots, stats, conversations, reports, tickets, etc.).

- `scripts/memory_schema_seller.mjs`  
  Zod schemas for seller slots, stats, conversation logs. Imported by other scripts — not invoked directly.

- `scripts/upsert_slot.mjs`  
  Atomically creates or updates one slot entry in `memory/slots.json`.

### Buyer

- `scripts/ensure_memory_state_buyer.mjs`  
  Same pattern as seller; initializes `memory/placements.json`, buyer stats, and shared dirs (conversations, reports, tickets).

- `scripts/memory_schema_buyer.mjs`  
  Zod schemas for buyer placements, stats, conversation logs. Imported only — not invoked directly.

- `scripts/upsert_placement.mjs`  
  Atomically creates or updates one placement in `memory/placements.json`.

- `scripts/append_conversation_event.mjs`  
  Appends a message to `memory/conversations/{contextId}.json` with atomic write.

## How The Scripts Work Together

- Run the **`ensure_memory_state_*`** script that matches your role before other workflows touch memory.
- Use **`upsert_slot.mjs`** or **`upsert_placement.mjs`** (not raw JSON) so writes are validated and atomic.
- Schema modules (`memory_schema_*.mjs`) are for imports only.
- Writes use a temp file + rename so readers never see partial JSON.

## Best Practices

- always run the correct `ensure_memory_state_*` before accessing memory files
- treat Zod validation failures as hard errors
- seller: one grouped record per slot lifecycle in `slots.json`
- buyer: one grouped record per placement in `placements.json`
