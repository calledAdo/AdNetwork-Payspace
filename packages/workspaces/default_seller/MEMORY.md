# Memory: Seller Agent

Memory is stored as JSON files in `$AGENT_DIR/memory/`.

**Atomic writes (required):** Always write JSON memory files via a temp file and rename,
never write directly to the target path. This prevents the gateway from reading partial data:
```bash
TMP=$(mktemp "$TARGET.XXXXXX")
echo "$JSON" > "$TMP"
mv "$TMP" "$TARGET"
```
`mv` (rename) is POSIX-atomic — readers always see either the old or the new complete file.

---

## `init_config.json` — minimal spawn-time config

```json
{
  "agentId": "agent_...",
  "agentType": "seller",
  "gateway_url": "https://block-N.payspace.io/a2a/agent_...",
  "a2aUrl": "https://block-N.payspace.io/a2a/agent_...",
  "pubkey": "0x03...",
  "blake160": "0x...",
  "ownerPubkey": "0x...",
  "siteUrl": "https://publisher.example"
}
```

The seller agent should not assume slot inventory lives in `init_config.json`.
Slot inventory is managed by the operator/platform and persisted in `memory/slots.json`.

---

## `slots.json` — seller-managed slot inventory

Initialize to `[]`.

Each slot entry should group seller-managed slot truth, on-chain publication
state, and booking/payment state.

```json
[
  {
    "snippet_id": "snip_abc123",
    "state": "streaming",

    "slot_details": {
      "owner_pubkey": "0x...",
      "page_url": "https://publisher.example/article-1",
      "dimensions": "728x90",
      "min_amount_per_1000": "1200",
      "ad_position": 0,
      "publication_mode": 1,
      "keyword_flags": "4",
      "policy_text": "No gambling",
      "metadata": {}
    },

    "publication": {
      "placement_id": "0xabc...:0",
      "placement_tx_hash": "0xabc...",
      "placement_index": 0,
      "price_per_mille": "1200",
      "gateway_url": "https://block.example/a2a/agent_seller_xyz",
      "published_at_block": 12345
    },

    "correlation_map": {
      "buyer_nonce_abc123": "ctx-f3a8b2"
    },

    "current_booking": {
      "context_id": "ctx-abc123",
      "buyer_pubkey": "0x03...",
      "buyer_blake160": "0x...",
      "buyer_a2a_url": "https://...",
      "agreed_price_per_mille": "1100",
      "channel_tx_hash": "0x...",
      "channel_index": 0,
      "channel_id": "0x...",
      "total_udt_locked": "1000000",
      "impressions_reported": 4200,
      "last_ticket": {
        "seller_claim_udt": "4200",
        "ticket_timestamp": 1712000000,
        "signature": "0x..."
      },
      "started_at": 1712000000,
      "dispute_tx_hash": null,
      "dispute_started_at": null
    },

    "history": [
      {
        "buyer_pubkey": "0x02...",
        "earned_udt": "8500",
        "impressions": 8500,
        "started_at": 1711900000,
        "closed_at": 1711950000
      }
    ],
    "updated_at": "2026-03-25T10:00:00.000Z"
  }
]
```

Valid slot states:

- `awaiting_install`
- `publishing`
- `available`
- `negotiating`
- `streaming`
- `closing`
- `disputed`

Notes:

- `snippet_id` is the seller-side stable slot identifier
- newly created slots should start in `awaiting_install`
- after operator/platform confirmation, slots should move to `publishing`
- once the seller agent has successfully published on-chain, the slot may move to `available`
- `publication.placement_id` is the current BookingSpace outpoint only
- `publication.placement_id`, `publication.placement_tx_hash`, and `publication.placement_index` must be overwritten after every on-chain publish, book, or unbook mutation because the cell is consumed and recreated
- `correlation_map` keeps first-message negotiation retries idempotent
- `current_booking` is `null` when the slot is not actively booked
- `updated_at` is seller-agent runtime bookkeeping, not backend business state

---

## `stats.json` — seller-side aggregates

```json
{
  "last_report_date": "2025-04-01",
  "total_revenue_udt": "45000",
  "total_impressions_served": 45000,
  "slots_total": 3,
  "slots_active": 2
}
```

Use `snippet_id`-based tracking for seller-side performance.

---

## `conversations/{contextId}.json`

Durable buyer negotiation / booking transcript for one booking context.

---

## `tickets/{channel_tx_hash}.jsonl`

Append-only received ticket log for audit and dispute evidence.

---

## `reports/daily/YYYY-MM-DD.json`

Daily seller-side revenue and slot activity rollup.

---

## `suspicious_messages.jsonl`

Append one JSON line per rejected or suspicious inbound message.
