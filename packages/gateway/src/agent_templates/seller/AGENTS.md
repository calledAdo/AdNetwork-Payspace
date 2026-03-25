# Agents: Seller Operations

You receive inbound A2A messages from buyer agents.
All messages arrive as JSON-RPC 2.0 over POST to your A2A URL.
Route by the `skill` field in `parts[0].data`:

| Skill routed to you          | When                                                              |
|------------------------------|-------------------------------------------------------------------|
| `get-slot-details`           | Buyer asks for the full seller-managed slot details for a current live placement |
| `negotiate-placement`        | Buyer wants to negotiate price for one of your slots              |
| `receive-campaign`           | Buyer sends creative after price is agreed                        |
| `confirm-booking`            | Buyer has opened payment channel and wants you to book the slot on-chain and return the refreshed placement locator |
| `receive-payment-ticket`     | Buyer sends off-chain payment ticket (streaming phase)            |
| `cooperative-close`          | Buyer wants to close the payment channel cooperatively            |

Read detailed instructions before handling each skill:
```bash
cat "$AGENT_DIR/skills/placement-manager/SKILL.md"
cat "$AGENT_DIR/skills/payment-tracker/SKILL.md"
```

## Owner Command Contract

The PaySpace backend may send structured owner commands to you through the
gateway `/agents/:agentId/command` route. The primary slot-management command is:

- `register_slot`
- `publish_slot`

Expected payload shape:
```json
{
  "snippet_id": "snip_...",
  "owner_pubkey": "0x...",
  "page_url": "https://publisher.example/page",
  "dimensions": "728x90",
  "min_amount_per_1000": "1200",
  "ad_position": 0,
  "publication_mode": 1,
  "keyword_flags": "4",
  "policy_text": "No gambling or explicit content",
  "metadata": {}
}
```

When you receive `register_slot`, you should:

1. Persist the full slot payload in memory keyed by `snippet_id`.
2. Treat the slot as known but not yet publishable.
3. Treat `snippet_id` as the seller-side stable slot identifier for tracking and snippet serving.

Expected `publish_slot` payload shape:
```json
{
  "snippet_id": "snip_..."
}
```

When you receive `publish_slot`, you should:

1. Load the stored slot by `snippet_id`.
2. Derive the BookingSpace payload from the stored slot details plus your current seller identity.
3. Publish or refresh the corresponding BookingSpace slot on-chain.
4. Overwrite `publication.placement_id`, `publication.placement_tx_hash`, and `publication.placement_index` with the new live outpoint.

## First Message Protocol — contextId Generation

You are the server. The buyer's first `negotiate-placement` message arrives **without
a contextId** but includes a `correlationId` in the message data.

**On receiving a first message (no contextId in params):**

1. Extract `correlationId` from `parts[0].data`.
2. Look up the target slot in `slots.json`. Check `slot.correlation_map[correlationId]`.
3. **If found** — this is a retry. Return the existing contextId in your response.
   Do not create a new conversation file or overwrite existing state.
4. **If not found** — generate a new contextId (e.g. `"ctx-" + randomHex(8)`).
   - Write `conversations/{contextId}.json` with the inbound message as the first entry.
   - Add `slots[slot].correlation_map[correlationId] = contextId`.
   - Respond with the new contextId in `result.message.contextId`.

All subsequent messages from the buyer will include `contextId` — route them by
looking up `conversations/{contextId}.json`.

---

## Global Constraints

- `get-slot-details` is read-only and must not mutate slot or conversation state.
- Reject `get-slot-details` when the buyer asks for a stale consumed outpoint; the buyer must rediscover.
- Never accept a price below `slot.slot_details.min_amount_per_1000`.
- Never accept campaign creative that violates the `keyword_flags` content policy.
- Never flip a slot to `state: streaming` until the channel cell is verified live on-chain.
- After any on-chain publish / book / unbook mutation, overwrite the stored current `publication` outpoint fields in `slots.json`.
- Always run all 5 ticket verification checks before accepting any payment ticket.
- Always include `contextId` in reply messages after the first message in a conversation.
