---
name: placement-scout
description: Discover available ad placements, resolve seller A2A endpoints, negotiate price, send campaign materials as tracked image/click URLs plus write-up, verify ad is live, and open payment channel.
---

# Skill: placement-scout

---

## Canonical Flow

Use this skill in the following order:

1. `discover_resolved_placements`
2. `fetch_slot_details_from_seller`
3. `negotiate_placement`
4. `register_tracking_booking`
5. `send_campaign_handoff`

Seller-managed slot details now come directly from the seller agent. The buyer
should not treat the backend as the canonical source of slot details.

## Configuration

Memory key: `buyer:config`
```json
{
  "campaign_id": "camp_xyz",
  "buyer_lock_args": "0x...",
  "buyer_pubkey": "0x03...",
  "buyer_blake160": "0x...",
  "buyer_a2a_url": "https://block-42.payspace.io/a2a/agent_buyer_xyz",
  "udt_type_args": "0x...",
  "total_budget_udt": "5000000",
  "spent_udt": "0",
  "max_price_per_mille": "1200",
  "keyword_flags": 4,
  "ad_position": 1,
  "allow_manual_publication": true,
  "campaign_materials": {
    "image_url": "https://cdn.advertiser.com/banner.png",
    "click_url": "https://advertiser.com/landing",
    "write_up": "Discover the future of blockchain infrastructure"
  }
}
```

Memory key: `buyer:placements`
```json
[
  {
    "context_id": "ctx-abc123",
    "placement_tx_hash": "0x...",
    "placement_index": 0,
    "seller_pubkey": "0x03...",
    "seller_blake160": "0x...",
    "seller_a2a_url": "https://...",
    "agreed_price_per_mille": "1100",
    "publication_mode": "SNIPPET_MANAGED",
    "state": "negotiating",
    "live_url": null,
    "element_id": null,
    "tracked_image_url": null,
    "tracked_click_url": null,
    "booking_id": null,
    "channel_tx_hash": null,
    "channel_index": 0,
    "total_udt_locked": null,
    "last_ticket_seller_claim": "0",
    "last_ticket_timestamp": "0",
    "last_verified_at": null,
    "task_ids": {
      "campaign_handoff": null,
      "channel_open_confirm": null,
      "coop_close": null
    },
    "manual_submission_task_id": null,
    "manual_submission_deadline": null
  }
]
```

---

## API Reference

MCP (`$MCP_URL`, default `http://localhost:3000`):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/discover/placements` | GET | List available placements with filters |
| `/placements/:tx_hash/:index` | GET | Fetch single placement cell |
| `/placements/:tx_hash/:index/details` | GET | Fetch IPFS details, verified against on-chain hash |
| `/transactions/build/settlement` | POST | Build payment channel open tx |
| `/transactions/submit` | POST | Broadcast signed tx |

Tracking service (`$TRACKING_URL`):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/stats/:id` | GET | Impressions + clicks for a placement (id = tx_hash:index) |

Playwright MCP (`$PLAYWRIGHT_MCP_URL`) — browser automation, called as native tools:

| Tool | Purpose |
|------|---------|
| `browser_navigate` | Load publisher page |
| `browser_scroll_to_element` | Bring ad slot into viewport |
| `browser_wait_for` | Wait for image load |
| `browser_evaluate` | Collect geometry, visibility, image state |
| `browser_network_requests` | Confirm tracking pixel fired |
| `browser_take_screenshot` | Screenshot ad slot as evidence |

Payspace details service (`$PAYSPACE_API_URL`) — Payspace users only; IPFS otherwise:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/placements/details/:placement_id` | GET | Fetch off-chain slot details (id = tx_hash:index) |

---

## Signing

All transactions signed locally via:
```bash
SIG=$(./scripts/sign_tx.sh --message "$SIGNING_MSG" | jq -r '.signature')
# or
./scripts/sign_and_submit.sh --build-url "..." --submit-url "..." --body "..."
```

---

## Workflow

### 1. Discover available placements

```bash
./skills/placement-scout/scripts/discover_placements.sh \
  --keyword-flags "$KEYWORD_FLAGS" \
  --max-price     "$MAX_PRICE_PER_IMPRESSION" \
  --ad-position   "$AD_POSITION" \
  --limit         20
```

Returns array of cells. Each has: `seller_pubkey`, `price_per_mille`, `gateway_url` (optional), `keyword_flags`, `ad_position`.

### 2. Resolve seller A2A endpoint

For each candidate placement:

**If `gateway_url` is present in cell:**
```bash
# gateway_url IS the seller's A2A endpoint URL
# Card is served at: <gateway_url>/.well-known/agent-card.json
CARD=$(curl -sf "${GATEWAY_URL}/.well-known/agent-card.json")
CARD_PUBKEY=$(echo "$CARD" | jq -r '.pubkey')

# Verify card pubkey matches on-chain cell pubkey (normalizes both sides)
./skills/placement-scout/scripts/verify_pubkey_match.sh \
  --card-pubkey "$CARD_PUBKEY" \
  --cell-pubkey "$SELLER_PUBKEY" || { echo "Card pubkey mismatch — skip" >&2; continue; }
```

**If no `gateway_url`:** the placement cell has no reachable A2A endpoint — skip this placement.
All valid sellers must have `gateway_url` set in their BookingSpace cell.

Extract `a2a_url` from the card — this is the endpoint for all A2A messages.

### 3. Fetch and verify placement details

```bash
DETAILS=$(./skills/placement-scout/scripts/fetch_placement_details.sh \
  --tx-hash       "$PLACEMENT_TX_HASH" \
  --index         "$PLACEMENT_INDEX" \
  --ipfs-present  "$(echo "$CELL" | jq -r '.slot.ipfs_present')")
```

When `ipfs_present=true`: the script calls `$MCP_URL/placements/$TX_HASH/$INDEX/details`.
The MCP server fetches from IPFS and verifies the blake2b hash against the on-chain cell — exits 1 on hash mismatch (tamper-evident, chain as root of trust).

When `ipfs_present=false`: falls back to `$PAYSPACE_API_URL/placements/details/tx_hash:index`.

Exits 1 on any verification failure — skip this placement if it fails.

Returns details blob: `site_url`, `dimensions`, `element_id`, `content_restrictions`, `language`.
Evaluate: site category, dimensions, content restrictions compatible with campaign?

### 4. Open A2A negotiation

Send first message — **no contextId** (seller generates it):

```bash
curl -sf -X POST "$SELLER_A2A_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "req-001",
    "method": "message/send",
    "params": {
      "message": {
        "messageId": "'"$(uuidgen)"'",
        "role": "user",
        "parts": [{
          "data": {
            "skill": "negotiate-placement",
            "placement_tx_hash": "'"$PLACEMENT_TX_HASH"'",
            "placement_index": '"$PLACEMENT_INDEX"',
            "offered_price_per_mille": "'"$OFFERED_PRICE"'",
            "campaign_duration_days": '"$DURATION_DAYS"',
            "buyer_pubkey": "'"$BUYER_PUBKEY"'",
            "buyer_blake160": "'"$BUYER_BLAKE160"'",
            "buyer_a2a_url": "'"$BUYER_A2A_URL"'"
          },
          "mediaType": "application/json"
        }]
      }
    }
  }'
```

**Extract `contextId` from response and save to `buyer:placements[].context_id` immediately.**
All subsequent messages for this placement must include this contextId.

If seller counters: evaluate counter vs budget. If acceptable: reply with `agreed: true`. If not: walk away.

### 5. Send campaign materials (after price agreed)

Construct tracked delivery URLs using `$TRACKING_URL` **before** sending to seller.
The buyer should only hand over:

- `tracked_image_url`
- `tracked_click_url`
- `write_up`

Generate them like this:
```bash
BOOKING=$(curl -sf -X POST "${TRACKING_URL}/bookings/register" \
  -H "Content-Type: application/json" \
  -d "{\"image_url\":\"${IMAGE_URL}\",\"destination_url\":\"${RAW_CLICK_URL}\"}")
TRACKED_IMAGE_URL=$(echo "$BOOKING" | jq -r '.tracked_image_url')
TRACKED_CLICK_URL=$(echo "$BOOKING" | jq -r '.tracked_click_url')
BOOKING_ID=$(echo "$BOOKING" | jq -r '.booking_id')
```

Send creative as multi-part A2A message with same contextId:
```bash
curl -sf -X POST "$SELLER_A2A_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "req-010",
    "method": "message/send",
    "params": {
      "message": {
        "messageId": "'"$(uuidgen)"'",
        "contextId": "'"$CONTEXT_ID"'",
        "role": "user",
        "parts": [
          {
            "data": {
              "skill": "receive-campaign",
              "agreed_price_per_mille": "'"$FINAL_PRICE"'",
              "tracked_image_url": "'"$TRACKED_IMAGE_URL"'",
              "tracked_click_url": "'"$TRACKED_CLICK_URL"'",
              "write_up": "'"$WRITE_UP"'"
            },
            "mediaType": "application/json"
          }
        ]
      }
    }
  }'
```

Save returned `task_id` to `buyer:placements[].task_ids.campaign_handoff` and
store:

- `booking_id`
- `tracked_image_url`
- `tracked_click_url`

in the placement memory entry.

**If publication_mode == MANUAL:**
- Set `manual_submission_deadline` = `$(date -u +%s)` + 172800 (48h)
- Set `state → "awaiting_publication"`
- Heartbeat will check periodically

**If SNIPPET_MANAGED:** poll task state until `TASK_STATE_COMPLETED`. Extract `live_url` and `element_id`.

### 6. Verify ad is live (BEFORE opening channel)

Use the checked-in helper:

```bash
./skills/placement-scout/scripts/verify_live_placement.sh \
  --page-url        "$LIVE_URL" \
  --element-id      "$ELEMENT_ID" \
  --dimensions      "$DIMENSIONS" \
  --booking-id      "$BOOKING_ID"
```

The helper uses the shared Playwright MCP sidecar to:

- navigate to the page
- scroll the target element into view
- wait for load
- evaluate geometry, visibility, and image state
- inspect network requests for buyer tracking
- save a screenshot

If `verified == false`: record which specific check failed, notify seller via
A2A, wait for fix, and retry. **Do NOT open channel until verified.**

### 7. Open payment channel

```bash
./scripts/sign_and_submit.sh \
  --build-url  "$MCP_URL/transactions/build/settlement" \
  --submit-url "$MCP_URL/transactions/submit" \
  --body "$(jq -n \
    --arg buyer  "$BUYER_LOCK_ARGS" \
    --arg seller "$SELLER_LOCK_ARGS" \
    --arg udt    "$UDT_TYPE_ARGS" \
    --arg amount "$CHANNEL_UDT_AMOUNT" \
    '{buyer_lock_args:$buyer, seller_lock_args:$seller, udt_type_args:$udt, udt_amount:$amount}')"
```

Save `channel_tx_hash` and `total_udt_locked` to placement memory. Set `state → "channel_open"`.

### 8. Notify seller of channel open

```bash
curl -sf -X POST "$SELLER_A2A_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "message/send",
    "params": {
      "message": {
        "messageId": "'"$(uuidgen)"'",
        "contextId": "'"$CONTEXT_ID"'",
        "role": "user",
        "parts": [{
          "data": {
            "skill": "confirm-booking",
            "channel_tx_hash": "'"$CHANNEL_TX_HASH"'",
            "channel_index": 0,
            "total_udt_locked": "'"$UDT_AMOUNT"'"
          },
          "mediaType": "application/json"
        }]
      }
    }
  }'
```

Save task_id to `task_ids.channel_open_confirm`. When task completes: set `state → "streaming"`.
