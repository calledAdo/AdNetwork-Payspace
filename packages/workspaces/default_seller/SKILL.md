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

## Optional skills

| Skill | Instructions | Profile |
|---|---|---|
| `messaging` | `cat "$SKILLS_DIR/messaging/SKILL.md"` | `cat "$SKILLS_DIR/messaging/PROFILE.md"` |
| `payspace_metric_tracker` | `cat "$SKILLS_DIR/payspace_metric_tracker/SKILL.md"` | `cat "$SKILLS_DIR/payspace_metric_tracker/PROFILE.md"` |

## Startup Checklist

At startup, do this first:

```bash
cat "$AGENT_DIR/USER.md"
cat "$AGENT_DIR/memory/init_config.json"
cat "$AGENT_DIR/pubkey"
node "$SKILLS_DIR/memory_manager/scripts/ensure_memory_state_seller.mjs"
```

Your seller lock args is the `blake160` value in the pubkey file.

## Minimal Spawn-Time Config

The seller agent is intentionally spawned with minimal business config.
Expect the owner to send slot definitions separately via owner commands.

Typical spawn-time config fields:

- `ownerPubkey`
- `siteUrl`
- gateway-injected identity fields such as `agentId`, `a2aUrl`, `pubkey`, and `blake160`

Do not assume slot inventory is present in `init_config.json`.

## Canonical Seller Flow

Run the seller workflow in this order:

1. publish or refresh the BookingSpace slot on-chain (when instructed by the operator)
2. answer buyer `get-slot-details` requests from stored slot data
3. negotiate placement terms
4. receive campaign handoff and activate snippet content
5. accept and verify payment tickets
6. cooperatively close or dispute when needed

## Command vs Script

- **Commands/tasks** (for example `publish_slot`, `receive-campaign`) describe
  business actions.
- **Scripts** are implementation tools under `$SKILLS_DIR/*/scripts/*.mjs`.
- One command/task may execute multiple scripts and memory operations.

## Connected Systems

- `MCP_URL` for BookingSpace publication, booking, cancel, and settlement checks
- `TRACKING_URL` for snippet loader delivery, snippet-content updates, and
  seller-side performance metrics

## Canonical Identifiers

- use `snippet_id` as the stable seller-side slot identity
- use `publication.placement_id` only as the current live BookingSpace locator
- use `current_booking.context_id` for one booking conversation
- use `current_booking.channel_id` and `current_booking.channel_tx_hash` for
  payment lifecycle work

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

- `exec` — run checked-in scripts in `$AGENT_DIR` or `$SKILLS_DIR`
- `memory_read` — inspect seller memory
- `memory_write` — persist seller memory

## Important Runtime Rules

- Seller-managed slot details are stored locally and exposed via `get-slot-details`.
- BookingSpace cells only get the smaller derived on-chain payload.
- Owner chat may instruct the agent to withdraw fuel or token balances back to the owner.

## Script Placement

All runtime scripts live inside their owning skill in `$SKILLS_DIR`:

- `$SKILLS_DIR/memory_manager/scripts/*` for memory layout and slot persistence
- `$SKILLS_DIR/native_signer/scripts/*` for signing and tx preflight
- `$SKILLS_DIR/asset_manager/scripts/*` for withdrawals
- `$SKILLS_DIR/slot_v1/scripts/*` for slot publication and booking
- `$SKILLS_DIR/payment_channel/scripts/*` for channel verification and tickets

Top-level `$AGENT_DIR/scripts/` is reserved for spawn-time key generation only.
