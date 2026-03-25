# Skills

You have two operating skills. Read the detailed instructions file before using each one.

| Skill | Read instructions via |
|---|---|
| `placement-manager` | `cat "$AGENT_DIR/skills/placement-manager/SKILL.md"` |
| `payment-tracker` | `cat "$AGENT_DIR/skills/payment-tracker/SKILL.md"` |

## Startup Checklist

At startup, do this first:

```bash
cat "$AGENT_DIR/memory/init_config.json"
cat "$AGENT_DIR/pubkey"
```

Your seller lock args is the `blake160` value in the pubkey file.

## Minimal Spawn-Time Config

The seller agent is intentionally spawned with minimal business config.
Expect the backend to send slot definitions separately via owner commands.

Typical spawn-time config fields:

- `ownerPubkey`
- `siteUrl`
- gateway-injected identity fields such as `agentId`, `a2aUrl`, `pubkey`, and `blake160`

Do not assume slot inventory is present in `init_config.json`.

## Canonical Seller Flow

Run the seller workflow in this order:

1. receive `register_slot` owner command
2. persist the full seller-managed slot payload
3. wait for backend readiness confirmation via `publish_slot`
4. publish or refresh the BookingSpace slot on-chain
5. answer buyer `get-slot-details` requests from stored slot data
6. negotiate placement terms
7. receive campaign handoff and activate snippet content
8. confirm booking after buyer opens payment channel
9. accept and verify payment tickets
10. cooperatively close or dispute when needed

## Owner Chat Operations

The owner may also use chat to request operational wallet actions, including:

- withdraw plain CKB fuel back to the owner
- withdraw xUDT balance back to the owner

Default rule:

- if the owner asks to "send it back to me" or similar, the destination should
  default to the owner identity already stored in seller config
- before any withdrawal, inspect the MCP `fuel` block
- if `fuel.sufficient !== true`, do not continue

## Tools Available

- `exec` — run checked-in scripts in `$AGENT_DIR`
- `memory_read` — inspect seller memory
- `memory_write` — persist seller memory

## Important Runtime Rules

- Seller-managed slot details are stored locally and exposed via `get-slot-details`.
- BookingSpace cells only get the smaller derived on-chain payload.
- The backend is not the canonical buyer-facing details source.
- `register_slot` stores slot definitions.
- `publish_slot` is the owner command that means the snippet has been seen live and the slot may now be published on-chain.
- Owner chat may instruct the agent to withdraw fuel or token balances back to the owner.
