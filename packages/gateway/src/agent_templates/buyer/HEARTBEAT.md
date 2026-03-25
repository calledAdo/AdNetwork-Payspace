# Heartbeat: Buyer Agent

Runs on a configurable cadence.
Each cycle:

1. load `memory/placements.json`
2. process placements by state
3. recompute aggregate campaign stats
4. optionally discover new placements
5. write daily reports if the UTC day rolled over

---

## State Machine

### `negotiating`

Expected memory areas:

- `discovery`
- `slot_details`
- `conversation`
- `negotiation`

Actions:

- wait for or process seller negotiation reply
- when seller returns `contextId`, persist it under `conversation.context_id`
- append outbound and inbound events to `conversations/{contextId}.json`
- if price is accepted, move to campaign handoff
- if price is rejected or too high, set state to `closed`

### `awaiting_publication`

Used for manual publication mode.

Actions:

- inspect `tasks.campaign_handoff`
- if completed, extract `delivery.live_url` and `delivery.element_id`
- move to `verifying`
- if `manual_submission_deadline` is exceeded, notify seller and close

### `verifying`

Use:

- `delivery.live_url` if present
- otherwise `slot_details.page_url`

Expected DOM target:

- `delivery.element_id` if seller returned it
- otherwise `slot_details.snippet_id`

Actions:

- run Playwright verification
- confirm the ad element exists and is visible
- confirm size matches `slot_details.dimensions`
- confirm tracking/network evidence fired
- save evidence

If verified:

- build and submit the payment channel
- persist `payment_channel.channel_tx_hash`, `channel_index`, `channel_id`, `total_udt_locked`
- send `confirm-booking`
- persist returned `tasks.channel_open_confirm`
- if seller returns a refreshed placement locator, persist it as the seller's current publication locator for audit only
- move to `channel_open`

If verification fails:

- increment `verification.verification_failures`
- update `verification.last_result`
- warn seller
- if failures cross threshold, close and dispute if funds are already at risk

### `channel_open`

Actions:

- poll `tasks.channel_open_confirm`
- fetch the on-chain placement cell
- confirm:
  - `booking_space.status == 1`
  - `booking_space.active_channel_id == payment_channel.channel_id`

If confirmed:

- set `verification.last_verified_at = now`
- move to `streaming`

If seller does not confirm within the retry window:

- resend `confirm-booking`

### `streaming`

This is the primary revenue loop.

Actions:

1. Read current placement cell state from MCP.
2. Read buyer-side performance stats using `delivery.booking_id`.
3. Re-run browser verification.
4. If verification fails, skip payment for this cycle and warn seller.
5. Compute new cumulative owed amount:
   `seller_claim = impressions * agreed_price_per_mille / 1000`
6. If `seller_claim` increased, sign and send a new payment ticket.
7. Update `payments.last_ticket_*`.
8. Evaluate underperformance, ACK timeouts, and budget exhaustion.

### `closing`

Actions:

- inspect `tasks.coop_close`
- if seller signature is available, rebuild and submit the cooperative close tx
- if timeout expires, fall back to dispute

### `disputed`

Actions:

- wait until the dispute window expires
- build and submit payout claim
- move to `closed`

### `closed`

No further operational work.
Keep the placement available for reporting and audit.

---

## Discovery Loop

Run alongside state processing.

If there is remaining budget and capacity for more placements:

1. run `discover_resolved_placements`
2. skip any `placement_id` already present in `placements.json`
3. fetch seller-managed slot details via `get-slot-details`
4. evaluate fit
5. initialize grouped placement state
6. begin negotiation

---

## Daily Reporting

At the end of the heartbeat cycle:

- sum buyer-side spend from placement payment state
- sum buyer-side impressions and clicks from booking tracking
- write `memory/reports/daily/YYYY-MM-DD.json`
- update `memory/stats.json`

Use `delivery.booking_id` for buyer-side performance metrics.
