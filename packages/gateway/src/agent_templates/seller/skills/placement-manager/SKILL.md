---
name: placement-manager
description: Publish and manage ad placement cells on the CKB blockchain. Handle A2A negotiations, publish creative, confirm bookings, release slots.
---

# Skill: placement-manager

---

## Configuration

Important:

- the canonical seller identity at spawn time is still minimal
- slot commercial rules come from `slot.slot_details`, not from old init-config defaults
- `publication.placement_id` is only the current live BookingSpace locator and must be overwritten after each on-chain slot mutation

Reads from `memory/init_config.json`:
```json
{
  "seller_lock_args":        "0x...",
  "pubkey":                  "0x03...",
  "blake160":                "0x...",
  "a2aUrl":                  "https://block-42.payspace.io/a2a/agent_seller_xyz",
  "default_price_per_mille": "1200",
  "floor_price_per_mille":   "800",
  "keyword_flags":    4,
  "ad_position":      1,
  "publication_mode": "SNIPPET_MANAGED",
  "udt_type_args":    "0x..."
}
```

Slot inventory is stored in `memory/slots.json` (see MEMORY.md for full schema).
Key fields per slot:
```json
{
  "slot_id":         "0xTX_HASH:INDEX",
  "price_per_mille": "1200",
  "state":           "available",
  "correlation_map": {},
  "current_booking": null,
  "history":         []
}
```

---

## API Reference

MCP (`$MCP_URL`, default `http://localhost:3000`):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/cells/fuel` | GET | Query spendable plain CKB fuel cells for a lock |
| `/transactions/build/transfer` | POST | Build plain CKB transfer (fuel withdrawal) |
| `/transactions/build/xudt-transfer` | POST | Build xUDT withdrawal transfer |
| `/placements/build/publish` | POST | Build publish tx — creates BookingSpace cell |
| `/placements/build/book` | POST | Build booking tx — flips slot to taken (status=1) |
| `/placements/build/cancel` | POST | Build cancel tx — resets slot to available (status=0) |
| `/placements/submit` | POST | Broadcast a signed placement tx |
| `/placements/:tx_hash/:index` | GET | Fetch placement cell with decoded data |

Tracking service (`$TRACKING_URL`) — Payspace users only:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/stats/:id` | GET | Impressions + clicks (id = tx_hash:index) |
| `/slot-details` | POST | Create stable slot details and get embed html |
| `/snippet-content` | POST | Submit signed snippet content update (`inactive|active`) |

Payspace details service (`$PAYSPACE_API_URL`) — Payspace users only:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/placements/details` | POST | Register signed off-chain slot details blob |

---

## Signing

All transactions are signed **locally** — no HTTP call to any signing server.

```bash
# Sign a tx signing_message
SIG=$(./scripts/sign_tx.sh --message "$SIGNING_MSG" | jq -r '.signature')

# Or use the combined build→sign→submit wrapper
./scripts/sign_and_submit.sh \
  --build-url  "$MCP_URL/placements/build/publish" \
  --submit-url "$MCP_URL/placements/submit" \
  --body       "$BODY"
```

`$AGENT_DIR` must be set in the environment — Express sets it at spawn time.

---

## Workflow

### Fuel preflight rule

Before any on-chain placement operation:

- inspect the MCP build response `fuel` block
- if `fuel.sufficient !== true`, do not sign or submit
- report the low-fuel state to the owner

This applies to:

- initial publish
- booking confirmation
- release/cancel
- owner withdrawals

### 1. Agent startup — register and publish

On first run, read identity from the agent's pubkey file and config from memory:

```bash
PUBKEY=$(jq -r '.pubkey'   "$AGENT_DIR/pubkey")
BLAKE160=$(jq -r '.blake160' "$AGENT_DIR/pubkey")

# Publish placement slot on-chain
# gateway_url is set to this agent's A2A URL — buyers discover the endpoint from the cell.
# No separate agent registry needed; the cell IS the discovery record.
./scripts/sign_and_submit.sh \
  --build-url  "$MCP_URL/placements/build/publish" \
  --submit-url "$MCP_URL/placements/submit" \
  --body "$(jq -n \
    --arg sla "$SELLER_LOCK_ARGS" --arg pk "$PUBKEY" \
    --arg price "$PRICE_PER_IMP" --argjson pos "$AD_POSITION" \
    --arg mode "$PUB_MODE" --argjson kf "$KEYWORD_FLAGS" \
    --arg gw "$SELLER_A2A_URL" \
    '{seller_lock_args:$sla, seller_pubkey:$pk, price_per_mille:$price,
      ad_position:$pos, publication_mode:$mode, keyword_flags:$kf, gateway_url:$gw}')"

# Register off-chain details with Payspace (or upload to IPFS for independent deployments)
./skills/placement-manager/scripts/register_details.sh \
  --seller      "$SELLER_LOCK_ARGS" \
  --tx-hash     "$PLACEMENT_TX_HASH" \
  --index       0 \
  --site-url    "$SITE_URL" \
  --dimensions  "728x90" \
  --element-id  "ad-slot-header-1"
```

Append new slot entry to `memory/slots.json` with `state: "available"`, `correlation_map: {}`, `current_booking: null`, `history: []`.

### 2. Respond to inbound A2A negotiation

**Message format:** JSON-RPC 2.0 `message/send`. The `skill` field in `parts[].data` routes to this handler.

Inbound (buyer's first message — no contextId yet):
```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "method": "message/send",
  "params": {
    "message": {
      "messageId": "<uuid>",
      "role": "user",
      "parts": [{
        "data": {
          "skill": "negotiate-placement",
          "placement_tx_hash": "0x...",
          "placement_index": 0,
          "offered_price_per_mille": "900",
          "campaign_duration_days": 30,
          "buyer_pubkey": "0x03...",
          "buyer_blake160": "0x...",
          "buyer_a2a_url": "https://..."
        },
        "mediaType": "application/json"
      }]
    }
  }
}
```

**contextId generation and deduplication:**

1. Extract `correlationId` from `parts[0].data`.
2. Look up `slot.correlation_map[correlationId]` in `slots.json`.
3. **If found** — retry detected. Return the existing contextId in your response. Stop here.
4. **If not found** — generate new contextId (e.g. `"ctx-" + randomHex(8)`).
   Add to `slot.correlation_map[correlationId] = contextId`.
   Write `memory/conversations/{contextId}.json` with this inbound message.

Evaluate:
- `offered_price_per_mille >= slot.slot_details.min_amount_per_1000`?
- Campaign category compatible with `keyword_flags`?
- Slot currently `state: "available"`?

Respond with a **Message** (negotiation is immediate, no Task needed):
```json
{
  "result": {
    "message": {
      "messageId": "<uuid>",
      "contextId": "ctx-abc123",
      "role": "agent",
      "parts": [{
        "data": { "agreed": true, "final_price_per_mille": "1100" },
        "mediaType": "application/json"
      }]
    }
  }
}
```

Or counter (buyer may reply again with same contextId):
```json
{ "agreed": false, "counter_price": "1100", "reason": "floor is 1000" }
```

### 3. Receive campaign materials (Task)

Buyer sends creative after price agreed, using the `contextId` from negotiation:
```json
{
  "data": {
    "skill": "receive-campaign",
    "agreed_price_per_mille": "1100",
    "tracked_image_url": "https://track.payspace.io/image?booking_id=book_123",
    "tracked_click_url": "https://track.payspace.io/click?booking_id=book_123",
    "write_up": "Discover the future of blockchain..."
  }
}
```
No separate raw image URL is required for the handoff when using tracked delivery.
The seller should render the buyer-provided `tracked_image_url` as the ad image
and `tracked_click_url` as the anchor href.

For `SNIPPET_MANAGED`, write those values into the signed `snippet_content`
update:

- `image_url = tracked_image_url`
- `action_url = tracked_click_url`
- `write_up = write_up`

Respond with a **Task** (publishing takes time):
```json
{
  "result": {
    "task": {
      "id": "task-campaign-<uuid>",
      "contextId": "ctx-abc123",
      "status": { "state": "TASK_STATE_WORKING" }
    }
  }
}
```

**SNIPPET_MANAGED:** Inject tracking URLs into the creative, publish via CMS, then update task to `TASK_STATE_COMPLETED` with:
```json
{
  "artifacts": [{
    "name": "placement_confirmation",
    "parts": [{
      "data": {
        "live_url": "https://publisher.example.com/article/xyz",
        "element_id": "ad-slot-header-1"
      },
      "mediaType": "application/json"
    }]
  }]
}
```

**MANUAL:** Notify publisher, keep task in WORKING state until publisher confirms. Complete within 48h.

### 4. Confirm channel open (Task)

Buyer sends after verifying the ad is live and opening the payment channel:
```json
{
  "data": {
    "skill": "confirm-booking",
    "channel_tx_hash": "0x...",
    "channel_index": 0,
    "total_udt_locked": "1000000"
  }
}
```

Create Task, then:

1. Verify channel cell exists on chain:
```bash
./skills/payment-tracker/scripts/check_channel.sh \
  --settlement-tx    "$CHANNEL_TX_HASH" \
  --settlement-index 0
```

2. Read `total_udt_locked` from cell data. Store as the **payment cap** — ticket verification uses this.

3. Flip slot to taken:
```bash
./skills/placement-manager/scripts/book_placement.sh \
  --seller     "$SELLER_LOCK_ARGS" \
  --tx-hash    "$PLACEMENT_TX_HASH" \
  --index      "$PLACEMENT_INDEX" \
  --channel-tx "$CHANNEL_TX_HASH"
# Then sign and submit the result
```

4. Update `slots.json`: `slot.state → "streaming"`, populate `slot.current_booking`
   with buyer info, channel details, `total_udt_locked`, `started_at: now`.
   Also overwrite `slot.publication.placement_id`, `slot.publication.placement_tx_hash`,
   and `slot.publication.placement_index` with the newly created live booking cell outpoint.

5. Complete the Task with confirmation artifact. Include the refreshed placement locator:
```json
{
  "artifacts": [{
    "name": "booking_confirmation",
    "parts": [{
      "data": {
        "placement_id": "0xnewtx...:0",
        "placement_tx_hash": "0xnewtx...",
        "placement_index": 0
      },
      "mediaType": "application/json"
    }]
  }]
}
```

### 5. Monitor booked placement

```bash
./skills/placement-manager/scripts/check_placement.sh \
  --tx-hash "$PLACEMENT_TX_HASH" \
  --index   "$PLACEMENT_INDEX"
```

If `status == 0` unexpectedly: check channel cell. If channel is spent and UDT received, close gracefully.

### 6. Release placement after close

After channel closes (cooperative or dispute payout received):
```bash
./skills/placement-manager/scripts/unbook_placement.sh \
  --seller  "$SELLER_LOCK_ARGS" \
  --tx-hash "$PLACEMENT_TX_HASH" \
  --index   "$PLACEMENT_INDEX"
# Then sign and submit
```

Update `slots.json`:
- Append `current_booking` summary to `slot.history[]` with `closed_at: now`
- Set `current_booking = null`
- Set `slot.state = "available"`
- Overwrite `slot.publication.placement_id`, `slot.publication.placement_tx_hash`,
  and `slot.publication.placement_index` with the new live available cell outpoint
- Remove `slot.correlation_map` entry for this context_id

### 7. Withdraw funds to owner

Use the local withdrawal helpers when the owner wants to move assets out of the
agent wallet:

```bash
# Withdraw plain CKB fuel
npx tsx "$AGENT_DIR/scripts/withdraw_fuel.mts" \
  --from "$SELLER_LOCK_ARGS" \
  --to   "$OWNER_LOCK_ARGS" \
  --amount 100

# Withdraw xUDT
npx tsx "$AGENT_DIR/scripts/withdraw_token.mts" \
  --from "$SELLER_LOCK_ARGS" \
  --to   "$OWNER_LOCK_ARGS" \
  --amount 500000 \
  --udt-type-args "$UDT_TYPE_ARGS"
```
