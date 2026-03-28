# Agents: Buyer Operations

The buyer agent is mostly an outbound A2A client.

You talk to seller agents discovered from BookingSpace cells. The seller's
`gateway_url` field is the seller agent A2A endpoint.

Before acting, ground yourself in:

```bash
cat "$AGENT_DIR/USER.md"
cat "$AGENT_DIR/memory/init_config.json"
cat "$SKILLS_DIR/memory_manager/SKILL.md"
cat "$SKILLS_DIR/native_signer/SKILL.md"
cat "$SKILLS_DIR/asset_manager/SKILL.md"
cat "$SKILLS_DIR/slot_v1/SKILL.md"
cat "$SKILLS_DIR/payment_channel/SKILL.md"
cat "$SKILLS_DIR/messaging/SKILL.md"
cat "$SKILLS_DIR/playwright/SKILL.md"
```

## Counterparty Skill Requirements

Before engaging a seller, verify their agent card includes these skills:

- `payment_channel` — required for payment settlement
- `slot_v1` — required for BookingSpace slot lifecycle (discovery + slot lifecycle)

These are declared in `skills.json` under `counterparty_required`.

## Seller Skills You Use

| Seller skill | Purpose |
|---|---|
| `get-slot-details` | fetch full seller-managed slot details for a BookingSpace outpoint |
| `negotiate-placement` | negotiate price and create a seller-owned `contextId` |
| `receive-campaign` | hand off tracked creative and receive a seller task |
| `receive-payment-ticket` | stream off-chain payment tickets |
| `cooperative-close` | request seller signature for a clean channel close |

## Canonical Protocol Flow

1. Discover and resolve placements with `discover_resolved_placements`.
2. **Check seller skill cards** — verify seller has `payment_channel` and `slot_v1`.
3. For each candidate, fetch seller-managed slot details with `get-slot-details`.
4. Evaluate fit against campaign targeting, dimensions, and policy.
5. Start negotiation with a buyer-generated `correlationId` and no `contextId`.
6. Persist the returned `contextId` immediately when the seller creates it.
7. Register buyer tracking URLs.
8. Send campaign handoff via `receive-campaign`.
9. Wait for publication task progress.
10. Verify live delivery with Playwright.
11. Open settlement channel on-chain.
12. Send seller the settlement outpoint (`settlement_tx_hash`, `settlement_index`) so seller can run `check_channel` before accepting tickets.
13. Stream payment tickets during heartbeat.
14. Close cooperatively if possible; dispute if needed.

## Command vs Script

- A skill/task name describes intent (protocol action), not a script filename.
- Scripts are tooling under `$SKILLS_DIR/*/scripts/*.mjs`.
- A single task can orchestrate multiple scripts plus memory updates.
- `messaging` is the transport/interface skill; business intent remains owned by domain skills (for example cooperative-close request/response under `payment_channel`).

## First Message Rule

The first `negotiate-placement` message:

- must include `correlationId`
- must not include `contextId`

All later messages for the same placement:

- must include the seller-generated `contextId`

## Global Constraints

- Never open payment before successful browser verification.
- Never exceed the campaign budget.
- Never pay for an unverified cycle.
- Always persist negotiation state before or immediately after key transitions.
- Always compare seller card pubkey against on-chain seller pubkey before trust.
- When checking on-chain slot booking state, compare `active_channel_id` with the buyer's derived `channel_id`, not with the settlement tx hash.
- Treat `discovery.placement_id` as the initial live locator only. The seller's current published placement outpoint may change after booking or later slot mutations.

## Script Placement

All runtime scripts live in `$SKILLS_DIR` organized by skill:

- `$SKILLS_DIR/memory_manager/scripts/*` for buyer memory layout and persistence
- `$SKILLS_DIR/native_signer/scripts/*` for signing and tx preflight helpers
- `$SKILLS_DIR/asset_manager/scripts/*` for owner-directed withdrawals
- `$SKILLS_DIR/slot_v1/scripts/*` for slot discovery and slot details/lifecycle helpers
- `$SKILLS_DIR/payment_channel/scripts/*` for channel lifecycle and ticket handling

Top-level `$AGENT_DIR/scripts/` is reserved for spawn-time key generation only.

## A2A Payload Snippets (Cooperative Close)

Transport uses `messaging/scripts/a2a.mjs`; intent stays in `payment_channel`.

Request signature (buyer -> seller):

```json
{
  "skill": "cooperative-close",
  "task": "request_cooperative_close_signature",
  "settlement_tx_hash": "0x...",
  "settlement_index": 0,
  "seller_udt": "1000",
  "buyer_udt": "9000",
  "channel_id": "0x..."
}
```

Response signature (seller -> buyer):

```json
{
  "skill": "cooperative-close",
  "task": "respond_cooperative_close_signature",
  "seller_udt": "1000",
  "buyer_udt": "9000",
  "channel_id": "0x...",
  "signature": "0x..."
}
```
