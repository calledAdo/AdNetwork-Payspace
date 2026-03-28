# Skills

Your workspace declares **essential** skills (always present) and **optional** skills
(may be installed depending on deployment).

## Essential skills

| Skill | Instructions | Profile |
|---|---|---|
| `memory_manager` | `cat "$SKILLS_DIR/memory_manager/SKILL.md"` | `cat "$SKILLS_DIR/memory_manager/PROFILE.md"` |
| `native_signer` | `cat "$SKILLS_DIR/native_signer/SKILL.md"` | `cat "$SKILLS_DIR/native_signer/PROFILE.md"` |
| `asset_manager` | `cat "$SKILLS_DIR/asset_manager/SKILL.md"` | `cat "$SKILLS_DIR/asset_manager/PROFILE.md"` |
| `slot_v1` | `cat "$SKILLS_DIR/slot_v1/SKILL.md"` | `cat "$SKILLS_DIR/slot_v1/PROFILE.md"` |
| `payment_channel` | `cat "$SKILLS_DIR/payment_channel/SKILL.md"` | `cat "$SKILLS_DIR/payment_channel/PROFILE.md"` |
| `messaging` | `cat "$SKILLS_DIR/messaging/SKILL.md"` | `cat "$SKILLS_DIR/messaging/PROFILE.md"` |

## Optional skills

| Skill | Instructions | Profile |
|---|---|---|
| `payspace_metric_tracker` | `cat "$SKILLS_DIR/payspace_metric_tracker/SKILL.md"` | `cat "$SKILLS_DIR/payspace_metric_tracker/PROFILE.md"` |
| `playwright` | `cat "$SKILLS_DIR/playwright/SKILL.md"` | `cat "$SKILLS_DIR/playwright/PROFILE.md"` |

## Startup Checklist

At startup, do this first:

```bash
cat "$AGENT_DIR/USER.md"
cat "$AGENT_DIR/memory/init_config.json"
cat "$AGENT_DIR/pubkey"
node "$SKILLS_DIR/memory_manager/scripts/ensure_memory_state_buyer.mjs"
```

Your buyer lock args is the `blake160` value in the pubkey file.

## Canonical Buyer Flow

Run the buyer workflow in this order:

1. discover resolved placements
2. fetch seller-managed slot details from the seller agent
3. evaluate slot fit against campaign constraints
4. negotiate placement terms
5. (optional) register buyer tracking / booking metrics
6. send campaign handoff
7. verify live delivery
8. open payment channel
9. stream payment tickets during heartbeat
11. cooperatively close or dispute when needed

## Command vs Script

- **Tasks/commands** describe the action to perform.
- **Scripts** are concrete implementation helpers in `$SKILLS_DIR/*/scripts/*.mjs`.
- One task can call multiple scripts; do not assume a 1:1 mapping.

## Connected Systems

- `MCP_URL` for discovery, placement reads, and settlement/dispute builders
- `TRACKING_URL` for tracked asset registration and booking metrics
- `PLAYWRIGHT_MCP_URL` for live-delivery verification

## Canonical Identifiers

- use `discovery.placement_id` for discovery and first seller contact
- use `conversation.context_id` for durable A2A continuity after seller assigns it
- use `delivery.booking_id` for buyer-side performance metrics
- use `payment_channel.channel_id` and `payment_channel.channel_tx_hash` for
  payment lifecycle work

## Owner Chat Operations

The owner may also use chat to request operational wallet actions, including:

- withdraw plain CKB fuel back to the owner
- withdraw xUDT balance back to the owner

Default rule:

- if the owner asks to "send it back to me" or similar, the destination should
  default to the owner identity already stored in buyer config
- before any withdrawal, inspect the MCP `fuel` block
- if `fuel.sufficient !== true`, do not continue

## Active Memory

```bash
cat "$AGENT_DIR/memory/placements.json"
cat "$AGENT_DIR/memory/stats.json"
```

## Durable Conversation and Ticket Logs

```bash
ls "$AGENT_DIR/memory/conversations"
ls "$AGENT_DIR/memory/tickets"
```

## Tools Available

- `exec` — run checked-in scripts in `$AGENT_DIR` or `$SKILLS_DIR`
- `memory_read` — inspect buyer memory files
- `memory_write` — persist buyer memory files

## Important Runtime Rules

- Use `discover_resolved_placements` as the main discovery entrypoint.
- Treat seller-managed slot details as coming from the seller agent, not from the backend.
- Use buyer `booking_id` for buyer-side performance tracking.
- Use the payment-channel `channel_id` when comparing on-chain slot state, not the settlement tx hash.
- Owner chat may instruct the agent to withdraw fuel or token balances back to the owner.

## Script Placement

All runtime scripts live inside their owning skill in `$SKILLS_DIR`:

- `$SKILLS_DIR/memory_manager/scripts/*` for memory layout and persistence
- `$SKILLS_DIR/native_signer/scripts/*` for signing and tx preflight
- `$SKILLS_DIR/asset_manager/scripts/*` for withdrawals
- `$SKILLS_DIR/slot_v1/scripts/*` for discovery and slot details/lifecycle
- `$SKILLS_DIR/payment_channel/scripts/*` for channel lifecycle and tickets

Top-level `$AGENT_DIR/scripts/` is reserved for spawn-time key generation only.
