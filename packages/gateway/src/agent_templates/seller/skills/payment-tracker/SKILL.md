---
name: payment-tracker
description: Receive and verify off-chain payment tickets from buyers. Dispute non-payment on-chain. Claim payout after dispute window. Handle cooperative close.
---

# Skill: payment-tracker

---

## Configuration

Payment tracker reads from `memory/init_config.json`:
```json
{
  "seller_lock_args": "0x...",
  "udt_type_args":    "0x...",
  "ticket_timeout_seconds": 3600
}
```

Channel state is stored inside the slot's `current_booking` in `memory/slots.json`:
```json
{
  "channel_tx_hash":  "0x...",
  "channel_index":    0,
  "channel_id":       "0x...",
  "buyer_pubkey":     "0x03...",
  "buyer_blake160":   "0x...",
  "total_udt_locked": "1000000",
  "impressions_reported": 4200,
  "last_ticket": {
    "seller_claim_udt":  "450000",
    "ticket_timestamp":  1711234567,
    "signature":         "0x..."
  },
  "started_at":         1711234567,
  "dispute_tx_hash":    null,
  "dispute_started_at": null
}
```

To update channel state: find the slot by `channel_tx_hash` in `slots.json` and
update `slot.current_booking` in place. Never create a separate channels file.

---

## API Reference

Base URL: `$MCP_URL` (default `http://localhost:3000`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/cells/fuel` | GET | Query spendable plain CKB fuel cells for a lock |
| `/cells/live` | GET | Check if settlement cell is still live |
| `/transactions/build/dispute` | POST | Build dispute tx (initiate or update) |
| `/transactions/build/payout` | POST | Build payout tx after dispute window expires |
| `/transactions/build/coop-close` | POST | Build cooperative close tx |
| `/transactions/submit` | POST | Broadcast signed tx |

---

## Signing

```bash
# Sign any tx signing_message
SIG=$(./scripts/sign_tx.sh --message "$SIGNING_MSG" | jq -r '.signature')

# Sign cooperative close message
SIG=$(./scripts/sign_coop.sh --message "$COOP_MSG" | jq -r '.signature')
```

---

## Off-chain Ticket Format

Tickets are 56-byte messages signed by the buyer:
```
[0..16)  seller_claim_udt   LE uint128 — cumulative UDT owed to seller so far
[16..24) ticket_timestamp   LE uint64  — monotonically increasing Unix seconds
[24..56) channel_id         32 bytes   — blake2b(first_input_tx_hash || first_input_index_LE4)
```

Signing message: `blake2b("ckb-default-hash", seller_claim(16LE) || timestamp(8LE) || channel_id(32))`

---

## Ticket Verification (5 checks — all must pass)

Run these on every incoming ticket before accepting:

**1. Signature:** Recover pubkey from signature over the signing message. Must match `buyer_pubkey` stored in channel memory (from channel cell lock args `[20..40)`).

**2. Monotonicity:**
- `new_seller_claim > last_ticket.seller_claim_udt`
- `new_ticket_timestamp > last_ticket.ticket_timestamp`

**3. Amount cap:**
- `new_seller_claim <= total_udt_locked`
- Critical fraud-prevention check — rejects tickets claiming more than deposited.

**4. Channel still live:**
```bash
./skills/payment-tracker/scripts/check_channel.sh \
  --settlement-tx    "$CHANNEL_TX_HASH" \
  --settlement-index 0
```
Response must have `"status": "live"`.

**5. Channel ID binding:**
`channel_id` in ticket must match channel_id derived from the settlement cell (blake2b of first input outpoint).

---

## Workflow

### Fuel preflight rule

Before dispute, payout, or cooperative-close submission:

- inspect the MCP build response `fuel` block
- if `fuel.sufficient !== true`, do not sign or submit
- report the low-fuel state to the owner

### 1. Receive off-chain payment ticket (A2A Message)

Buyer sends via A2A `message/send`:
```json
{
  "jsonrpc": "2.0",
  "method": "message/send",
  "params": {
    "message": {
      "messageId": "<uuid>",
      "contextId": "ctx-abc123",
      "role": "user",
      "parts": [{
        "data": {
          "skill": "receive-payment-ticket",
          "seller_claim_udt": "45000",
          "ticket_timestamp": "1710001234",
          "channel_id": "0x...",
          "signature": "0x...65bytes"
        },
        "mediaType": "application/json"
      }]
    }
  }
}
```

Run all 5 verification checks. If valid:
- Update `slots[].current_booking.last_ticket` in `slots.json`
- Append received ticket to `memory/tickets/{channel_tx_hash}.jsonl` (see Ticket Log below)
- Respond with Message acknowledgement: `{ "accepted": true, "seller_claim_udt": "45000" }`

If invalid:
- Respond with rejection: `{ "accepted": false, "reason": "..." }`
- Do NOT update memory

### 2. Heartbeat — check for ticket timeout

Run every heartbeat. For each slot with `state: "streaming"`:

```bash
LAST_TICKET_AT=$(jq -r '.current_booking.last_ticket.ticket_timestamp' slot_entry)
NOW=$(date -u +%s)
TIMEOUT=$(jq -r '.ticket_timeout_seconds // 3600' memory/init_config.json)

if (( NOW - LAST_TICKET_AT > TIMEOUT )); then
  # Buyer has gone silent — initiate dispute
fi
```

### 3. Initiate dispute

```bash
RESULT=$(./skills/payment-tracker/scripts/initiate_dispute.sh \
  --caller           "$SELLER_LOCK_ARGS" \
  --settlement-tx    "$CHANNEL_TX_HASH" \
  --settlement-index 0 \
  --seller-claim     "$LAST_SELLER_CLAIM" \
  --ticket-timestamp "$LAST_TICKET_TS" \
  --buyer-sig        "$LAST_TICKET_SIG")

SIGNING_MSG=$(echo "$RESULT" | jq -r '.signing_message')
TX=$(echo "$RESULT" | jq -c '.tx')
SIG=$(./scripts/sign_tx.sh --message "$SIGNING_MSG" | jq -r '.signature')

curl -sf -X POST "$MCP_URL/transactions/submit" \
  -H "Content-Type: application/json" \
  -d "{\"tx\": $TX, \"signature\": \"$SIG\"}"
```

Update `slots.json`: `slot.state → "disputed"`,
`slot.current_booking.dispute_tx_hash → <tx_hash>`,
`slot.current_booking.dispute_started_at → now`.

### 4. Claim payout after dispute window (24 hours)

```bash
NOW=$(date -u +%s)
DISPUTE_START=$(jq -r '.dispute_start_seconds' channel_entry)

if (( NOW >= DISPUTE_START + 86400 )); then
  RESULT=$(./skills/payment-tracker/scripts/claim_payout.sh \
    --caller        "$SELLER_LOCK_ARGS" \
    --settlement-tx "$DISPUTE_TX_HASH" \
    --settlement-index 0)

  SIGNING_MSG=$(echo "$RESULT" | jq -r '.signing_message')
  TX=$(echo "$RESULT" | jq -c '.tx')
  SIG=$(./scripts/sign_tx.sh --message "$SIGNING_MSG" | jq -r '.signature')

  curl -sf -X POST "$MCP_URL/transactions/submit" \
    -H "Content-Type: application/json" \
    -d "{\"tx\": $TX, \"signature\": \"$SIG\"}"

  # Update slots.json:
  # - Move current_booking to slot.history[]
  # - Set current_booking = null
  # - Set slot.state = "available"
fi
```

### 5. Cooperative close (Task)

Buyer initiates coop close via A2A Task:
```json
{
  "data": {
    "skill": "cooperative-close",
    "coop_signing_message": "0xDDD...",
    "seller_udt": "800000",
    "buyer_udt": "200000",
    "buyer_sig": "0xEEE..."
  }
}
```

Create Task, then verify:
1. `seller_udt + buyer_udt == total_udt_locked` (conservation check)
2. `seller_udt >= last_ticket.seller_claim_udt` (seller not under-paid vs last ticket)
3. Signature of `coop_signing_message` from `buyer_sig` recovers to `buyer_pubkey`

If valid, sign:
```bash
SIG=$(./scripts/sign_coop.sh --message "$COOP_SIGNING_MSG" | jq -r '.signature')
```

Complete Task with seller_sig artifact:
```json
{
  "artifacts": [{
    "name": "seller_coop_sig",
    "parts": [{ "data": { "seller_sig": "0x..." }, "mediaType": "application/json" }]
  }]
}
```

Buyer then submits the cooperative close tx. Update `slots.json`:
- Move `current_booking` to `slot.history[]` with `closed_at: now`
- Set `current_booking = null`
- Set `slot.state = "available"`
- Remove `correlation_map` entry for this context_id

---

## Ticket Log

Each received ticket is appended as a newline-delimited JSON entry to
`memory/tickets/{channel_tx_hash}.jsonl`.

Using `channel_tx_hash` as the filename (not slot_id) ensures uniqueness across
multiple bookings on the same slot over time.

**Entry written when ticket is received and verified:**
```json
{"seq":1,"sellerClaimUdt":"1100","ticketTimestamp":1712001000,"channelId":"0x...","signature":"0x...","receivedAt":1712001002,"verified":true}
```

If ticket fails verification, still log it with `"verified": false` and the
failure reason — useful for dispute evidence:
```json
{"seq":0,"sellerClaimUdt":"9999999","ticketTimestamp":1712001000,"channelId":"0x...","signature":"0x...","receivedAt":1712001002,"verified":false,"reason":"amount exceeds total_udt_locked"}
```

The last verified entry is the one used in dispute and payout scripts.

---

## Error Handling

| Situation | Action |
|-----------|--------|
| No tickets after `ticket_timeout_seconds` | Run `initiate_dispute.sh` with last valid ticket |
| `DisputeWindowNotExpired` on payout | Wait, check `dispute_start_seconds + 86400`, retry |
| Settlement cell already spent | Channel closed cooperatively; verify UDT cell received |
| Ticket `seller_claim > total_udt_locked` | Reject ticket, log fraud attempt, consider dispute |
