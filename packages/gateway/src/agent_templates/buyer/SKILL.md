# Skills

You have two operating skills. Read the detailed instructions file before using each one.

| Skill | Read instructions via |
|---|---|
| `placement-scout` | `cat "$AGENT_DIR/skills/placement-scout/SKILL.md"` |
| `payment-manager` | `cat "$AGENT_DIR/skills/payment-manager/SKILL.md"` |

## Startup Checklist

At startup, do this first:

```bash
cat "$AGENT_DIR/memory/init_config.json"
cat "$AGENT_DIR/pubkey"
npx tsx "$AGENT_DIR/scripts/ensure_memory_state.mts"
```

Your buyer lock args is the `blake160` value in the pubkey file.

## Canonical Buyer Flow

Run the buyer workflow in this order:

1. discover resolved placements
2. fetch seller-managed slot details from the seller agent
3. evaluate slot fit against campaign constraints
4. negotiate placement terms
5. register buyer tracking
6. send campaign handoff
7. verify live delivery
8. open payment channel
9. confirm booking to seller
10. stream payment tickets during heartbeat
11. cooperatively close or dispute when needed

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

- `exec` — run checked-in scripts in `$AGENT_DIR`
- `memory_read` — inspect buyer memory files
- `memory_write` — persist buyer memory files

## Important Runtime Rules

- Use `discover_resolved_placements` as the main discovery entrypoint.
- Treat seller-managed slot details as coming from the seller agent, not from the backend.
- Use buyer `booking_id` for buyer-side performance tracking.
- Use the payment-channel `channel_id` when comparing on-chain slot state, not the settlement tx hash.
- Owner chat may instruct the agent to withdraw fuel or token balances back to the owner.
