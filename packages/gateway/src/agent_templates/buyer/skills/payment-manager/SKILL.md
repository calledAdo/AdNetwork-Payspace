---
name: payment-manager
description: Open payment channels, sign and send off-chain tickets on a recurring schedule, handle cooperative close, and dispute non-delivery.
---

# Skill: payment-manager

---

## Configuration

Memory key: `buyer:payment:config`
```json
{
  "udt_type_args": "0x...",
  "dispute_window_seconds": 86400
}
```

Active channels live in `buyer:placements[].channel_tx_hash` — no separate channel config key.

---

## API Reference

Base URL: `$MCP_URL` (default `http://localhost:3000`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/cells/fuel` | GET | Query spendable plain CKB fuel cells for a lock |
| `/transactions/build/transfer` | POST | Build plain CKB transfer (fuel withdrawal) |
| `/transactions/build/xudt-transfer` | POST | Build xUDT withdrawal transfer |
| `/transactions/build/settlement` | POST | Build payment channel open tx |
| `/transactions/build/coop-close` | POST | Build cooperative close tx + coop_signing_message |
| `/transactions/build/dispute` | POST | Build dispute tx using last sent ticket |
| `/transactions/build/payout` | POST | Build payout tx after dispute window |
| `/transactions/submit` | POST | Broadcast signed tx |

---

## Signing

All transactions and tickets signed locally:
```bash
# Sign tx
SIG=$(./scripts/sign_tx.sh --message "$SIGNING_MSG" | jq -r '.signature')

# Sign off-chain payment ticket
TICKET=$(./skills/payment-manager/scripts/sign_ticket.sh \
  --seller-claim "$NEW_SELLER_CLAIM" \
  --timestamp    "$(date -u +%s)" \
  --channel-id   "$CHANNEL_ID")
SIG=$(echo "$TICKET" | jq -r '.signature')
```

---

## Off-chain Ticket Format

56-byte messages signed by the buyer:
```
[0..16)  seller_claim_udt   LE uint128 — cumulative UDT owed to seller
[16..24) ticket_timestamp   LE uint64  — monotonically increasing Unix seconds
[24..56) channel_id         32 bytes   — blake2b(first_input_tx_hash || first_input_index_LE4)
```

Key invariants:
- Each ticket's `seller_claim_udt` must be **greater than** the previous ticket's
- Each ticket's `timestamp` must be **greater than** the previous ticket's
- `seller_claim_udt` must **never exceed** `total_udt_locked`

---

## Workflow

### Fuel preflight rule

Before any blockchain operation:

- inspect the MCP build response `fuel` block
- if `fuel.sufficient !== true`, do not sign or submit
- report the low-fuel state to the owner

The same rule applies to:

- settlement open
- cooperative close
- dispute
- payout
- owner withdrawals

### 1. Sign and send payment ticket (heartbeat — streaming state)

Compute new cumulative amount (CPM — price per 1000 impressions):
```bash
NEW_SELLER_CLAIM=$(echo "$IMPRESSIONS_SO_FAR * $AGREED_PRICE_PER_MILLE / 1000" | bc)

# Only send if amount has increased since last ticket
if (( NEW_SELLER_CLAIM <= LAST_TICKET_SELLER_CLAIM )); then
  exit 0  # Nothing new to pay — skip this cycle
fi
```

Sign ticket:
```bash
TICKET=$(./skills/payment-manager/scripts/sign_ticket.sh \
  --seller-claim "$NEW_SELLER_CLAIM" \
  --timestamp    "$(date -u +%s)" \
  --channel-id   "$CHANNEL_ID")

SIG=$(echo "$TICKET" | jq -r '.signature')
TS=$(echo "$TICKET"  | jq -r '.ticket_timestamp')
```

Send to seller via A2A Message:
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
            "skill": "receive-payment-ticket",
            "seller_claim_udt": "'"$NEW_SELLER_CLAIM"'",
            "ticket_timestamp": "'"$TS"'",
            "channel_id": "'"$CHANNEL_ID"'",
            "signature": "'"$SIG"'"
          },
          "mediaType": "application/json"
        }]
      }
    }
  }'
```

Update `buyer:placements[].last_ticket_seller_claim` and `last_ticket_timestamp` in memory.

### 2. Cooperative close (when campaign budget exhausted or end date reached)

**Step 1:** Build coop close tx to get the signing message (placeholder sigs required by builder):
```bash
ZERO_SIG="0x$(printf '0%.0s' {1..130})"

COOP=$(./skills/payment-manager/scripts/coop_close.sh \
  --caller           "$BUYER_LOCK_ARGS" \
  --settlement-tx    "$CHANNEL_TX_HASH" \
  --settlement-index 0 \
  --seller-udt       "$SELLER_UDT" \
  --buyer-udt        "$BUYER_UDT")

COOP_MSG=$(echo "$COOP" | jq -r '.coop_signing_message')
```

**Step 2:** Sign with buyer's key:
```bash
BUYER_SIG=$(./scripts/sign_coop.sh --message "$COOP_MSG" | jq -r '.signature')
```

**Step 3:** Send to seller via A2A Task:
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
            "skill": "cooperative-close",
            "coop_signing_message": "'"$COOP_MSG"'",
            "seller_udt": "'"$SELLER_UDT"'",
            "buyer_udt": "'"$BUYER_UDT"'",
            "buyer_sig": "'"$BUYER_SIG"'"
          },
          "mediaType": "application/json"
        }]
      }
    }
  }'
```

Save task_id to `task_ids.coop_close`.

**Step 4:** When task completes, extract `seller_sig` from artifact. Rebuild tx with real sigs embedded, then sign the fee cell witness and submit:
```bash
# Rebuild tx with both real sigs — witnesses array now contains the complete coop witness
FINAL=$(./skills/payment-manager/scripts/coop_close.sh \
  --caller           "$BUYER_LOCK_ARGS" \
  --settlement-tx    "$CHANNEL_TX_HASH" \
  --settlement-index 0 \
  --seller-udt       "$SELLER_UDT" \
  --buyer-udt        "$BUYER_UDT" \
  --buyer-sig        "$BUYER_SIG" \
  --seller-sig       "$SELLER_SIG")

SIGNING_MSG=$(echo "$FINAL" | jq -r '.signing_message')
TX=$(echo "$FINAL" | jq -c '.tx')

# Sign the fee cell witness (tx is complete; this is the final authorization)
FEE_SIG=$(./scripts/sign_tx.sh --message "$SIGNING_MSG" | jq -r '.signature')

curl -sf -X POST "$MCP_URL/transactions/submit" \
  -H "Content-Type: application/json" \
  -d "{\"tx\": $TX, \"signature\": \"$FEE_SIG\"}"
```

### 3. Dispute (seller unresponsive or ad not live)

Use the **last ticket the buyer sent** (not the last one the seller acknowledged):
```bash
RESULT=$(./skills/payment-manager/scripts/build_dispute.sh \
  --caller           "$BUYER_LOCK_ARGS" \
  --settlement-tx    "$CHANNEL_TX_HASH" \
  --settlement-index 0 \
  --seller-claim     "$LAST_TICKET_SELLER_CLAIM" \
  --ticket-timestamp "$LAST_TICKET_TIMESTAMP" \
  --buyer-sig        "$LAST_TICKET_SIG")

SIGNING_MSG=$(echo "$RESULT" | jq -r '.signing_message')
TX=$(echo "$RESULT" | jq -c '.tx')
SIG=$(./scripts/sign_tx.sh --message "$SIGNING_MSG" | jq -r '.signature')

curl -sf -X POST "$MCP_URL/transactions/submit" \
  -H "Content-Type: application/json" \
  -d "{\"tx\": $TX, \"signature\": \"$SIG\"}"
```

Update placement: `state → "disputed"`.

### 4. Reclaim remaining funds after dispute window

Once `current_unix_time >= dispute_submitted_at + 86400`:
```bash
RESULT=$(./skills/payment-manager/scripts/build_payout.sh \
  --caller        "$BUYER_LOCK_ARGS" \
  --settlement-tx "$DISPUTE_TX_HASH" \
  --settlement-index 0)

SIGNING_MSG=$(echo "$RESULT" | jq -r '.signing_message')
TX=$(echo "$RESULT" | jq -c '.tx')
SIG=$(./scripts/sign_tx.sh --message "$SIGNING_MSG" | jq -r '.signature')

curl -sf -X POST "$MCP_URL/transactions/submit" \
  -H "Content-Type: application/json" \
  -d "{\"tx\": $TX, \"signature\": \"$SIG\"}"
```

Update placement: `state → "closed"`.

### 5. Withdraw funds to owner

Use the local withdrawal helpers when the owner wants to move assets out of the
agent wallet:

```bash
# Withdraw plain CKB fuel
npx tsx "$AGENT_DIR/scripts/withdraw_fuel.mts" \
  --from "$BUYER_LOCK_ARGS" \
  --to   "$OWNER_LOCK_ARGS" \
  --amount 100

# Withdraw xUDT
npx tsx "$AGENT_DIR/scripts/withdraw_token.mts" \
  --from "$BUYER_LOCK_ARGS" \
  --to   "$OWNER_LOCK_ARGS" \
  --amount 500000 \
  --udt-type-args "$UDT_TYPE_ARGS"
```

---

## Ticket Log

Each sent ticket is appended as a newline-delimited JSON entry to
`memory/tickets/<placement_id_underscore>.jsonl`
(colons in placement_id replaced with underscores for filesystem safety,
e.g. `abc123_0.jsonl`).

**Entry written when ticket is sent:**
```json
{"seq":1,"sellerClaimUdt":"4200","ticketTimestamp":1712000000,"channelId":"0x...","signature":"0x...","sentAt":1712000001}
```

**`ackReceived` field appended as a new line** when the seller ACK arrives — never
in-place update:
```json
{"seq":1,"sellerClaimUdt":"4200","ticketTimestamp":1712000000,"channelId":"0x...","signature":"0x...","sentAt":1712000001,"ackReceived":1712000005}
```

Fields:
| Field | Type | Description |
|-------|------|-------------|
| `seq` | int | Monotonically increasing ticket sequence number |
| `sellerClaimUdt` | string | Cumulative UDT owed (string to preserve uint128 precision) |
| `ticketTimestamp` | int | Unix seconds embedded in ticket |
| `channelId` | hex | 32-byte channel ID |
| `signature` | hex | Buyer's secp256k1 signature over the 56-byte ticket |
| `sentAt` | int | Unix seconds when ticket was transmitted |
| `ackReceived` | int | Unix seconds when seller ACK arrived (appended later) |

The last line **without** `ackReceived` is the last unacknowledged ticket — used
for the dispute workflow if the seller goes silent.

---

## Error Handling

| Situation | Action |
|-----------|--------|
| Seller ACK stops arriving | Run dispute workflow with last sent ticket |
| Ad fails Playwright verification | Pause tickets; notify seller via A2A; wait for fix |
| `DisputeWindowNotExpired` on payout | Wait, compute `dispute_start + 86400`, retry |
| Coop close task times out | Fall back to dispute |
