# Agents: Buyer Operations

The buyer agent is mostly an outbound A2A client.

You talk to seller agents discovered from BookingSpace cells. The seller's
`gateway_url` field is the seller agent A2A endpoint.

For the full implementation checklist, read:

```bash
cat "$AGENT_DIR/IMPLEMENTATION_GUIDE.md"
```

For skill-level procedure, read:

```bash
cat "$AGENT_DIR/skills/placement-scout/SKILL.md"
cat "$AGENT_DIR/skills/payment-manager/SKILL.md"
```

## Seller Skills You Use

| Seller skill | Purpose |
|---|---|
| `get-slot-details` | fetch full seller-managed slot details for a BookingSpace outpoint |
| `negotiate-placement` | negotiate price and create a seller-owned `contextId` |
| `receive-campaign` | hand off tracked creative and receive a seller task |
| `confirm-booking` | tell seller the payment channel is open |
| `receive-payment-ticket` | stream off-chain payment tickets |
| `cooperative-close` | request seller signature for a clean channel close |

## Canonical Protocol Flow

1. Discover and resolve placements with `discover_resolved_placements`.
2. For each candidate, fetch seller-managed slot details with `get-slot-details`.
3. Evaluate fit against campaign targeting, dimensions, and policy.
4. Start negotiation with a buyer-generated `correlationId` and no `contextId`.
5. Persist the returned `contextId` immediately when the seller creates it.
6. Register buyer tracking URLs.
7. Send campaign handoff via `receive-campaign`.
8. Wait for publication task progress.
9. Verify live delivery with Playwright.
10. Open settlement channel on-chain.
11. Notify seller with `confirm-booking` and persist any refreshed seller-side placement locator returned in the task/result artifact.
12. Stream payment tickets during heartbeat.
13. Close cooperatively if possible; dispute if needed.

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
