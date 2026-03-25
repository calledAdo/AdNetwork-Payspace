# Buyer Agent Implementation Guide

This guide turns the buyer template docs into an implementation checklist we can
build against. It focuses on:

- what the buyer is responsible for
- which external calls it should make
- what memory it should read and write
- what should happen on each heartbeat state
- which gaps in the current integration need to be handled carefully

Use this alongside:

- `AGENTS.md`
- `HEARTBEAT.md`
- `SKILL.md`
- `skills/placement-scout/SKILL.md`
- `skills/payment-manager/SKILL.md`

## 1. Buyer Responsibilities

The buyer agent is the campaign operator for one advertiser campaign.

It must:

- enforce campaign budget, max CPM, keyword flags, and ad position
- discover candidate placements on-chain through the MCP service
- resolve seller A2A endpoints and verify seller identity
- negotiate placement terms with sellers
- register tracking URLs before handing creative to the seller
- verify ad delivery with Playwright before opening payment
- open settlement channels on-chain
- stream off-chain payment tickets as impressions accumulate
- monitor delivery quality and seller responsiveness
- cooperatively close channels when campaigns finish cleanly
- dispute and reclaim funds when seller delivery or responsiveness breaks down
- produce daily reports and maintain durable placement memory

## 2. Core Inputs

### Spawn-time campaign config

Read from `memory/init_config.json`.

Required fields:

- `campaignId`
- `ownerPubkey`
- `totalBudgetUdt`
- `maxPricePerMille`
- `keywordFlags`
- `adPosition`
- `creative.image_url`
- `creative.click_url`
- `creative.write_up`
- `agentId`
- `agentType`
- `a2aUrl`
- `pubkey`
- `blake160`

### Environment variables

The buyer implementation depends on:

- `MCP_URL`
- `TRACKING_URL`
- `PLAYWRIGHT_MCP_URL`
- `AGENT_DIR`

### Durable memory files

The buyer should maintain:

- `memory/init_config.json`
- `memory/placements.json`
- `memory/stats.json`
- `memory/conversations/{contextId}.json`
- `memory/tickets/{placement_id_underscore}.jsonl`
- `memory/reports/daily/YYYY-MM-DD.json`
- `memory/suspicious_messages.jsonl`

## 3. Buyer Method Surface

Recommended method list for the buyer runtime:

- `loadConfig()`
- `loadPlacements()`
- `savePlacements()`
- `discoverResolvedPlacements()`
- `fetchSlotDetailsFromSeller()`
- `evaluatePlacementFit()`
- `negotiatePlacement()`
- `registerTrackingBooking()`
- `sendCampaignHandoff()`
- `verifyPlacementLive()`
- `openPaymentChannel()`
- `confirmBookingToSeller()`
- `pollCampaignHandoffTask()`
- `pollChannelOpenTask()`
- `checkPlacementStats()`
- `signPaymentTicket()`
- `sendPaymentTicket()`
- `detectAckTimeout()`
- `attemptCooperativeClose()`
- `submitCooperativeClose()`
- `submitDispute()`
- `submitPayoutClaim()`
- `writeDailyReport()`
- `appendConversationEvent()`
- `appendTicketLog()`
- `logSuspiciousMessage()`

## 4. External Call Matrix

### MCP calls

The buyer should make these MCP calls:

- `GET {MCP_URL}/discover/placements`
- `GET {MCP_URL}/placements/{txHash}/{index}`
- `POST {MCP_URL}/transactions/build/settlement`
- `POST {MCP_URL}/transactions/build/coop-close`
- `POST {MCP_URL}/transactions/build/dispute`
- `POST {MCP_URL}/transactions/build/payout`
- `POST {MCP_URL}/transactions/submit`

The local helpers already map to those endpoints:

- `skills/placement-scout/scripts/discover_resolved_placements.mts`
- `skills/placement-scout/scripts/check_placement.mts`
- `skills/payment-manager/scripts/open_channel.mts`
- `skills/payment-manager/scripts/coop_close.mts`
- `skills/payment-manager/scripts/build_dispute.mts`
- `skills/payment-manager/scripts/build_payout.mts`

### Tracking/backend calls

The buyer should make these tracking calls:

- register booking tracking
- fetch placement-level stats

Canonical backend routes currently live under the backend router prefix:

- `POST /tracking/bookings/register`
- `GET /tracking/stats/:id`

Implementation note:

The current buyer skill docs describe these as `${TRACKING_URL}/bookings/register`
and `${TRACKING_URL}/stats/:id`, but the backend mounts them under `/tracking`.
Before wiring the buyer runtime, decide one of these two approaches and keep the
code consistent:

- treat `TRACKING_URL` as the backend origin, then call `${TRACKING_URL}/tracking/...`
- treat `TRACKING_URL` as already including the `/tracking` prefix

Do not mix both interpretations.

### Seller identity bootstrap

Canonical flow:

1. discover candidate placements
2. fetch seller card from on-chain `gateway_url`
3. compare card pubkey against on-chain `seller_pubkey`
4. keep only resolved, identity-verified seller endpoints

Primary helper:

- `skills/placement-scout/scripts/discover_resolved_placements.mts`

Low-level helpers retained for reuse:

- `skills/placement-scout/scripts/discover_placements.mts`
- `skills/placement-scout/scripts/resolve_seller_endpoint.mts`
- `skills/placement-scout/scripts/verify_pubkey_match.mts`

### Seller-managed slot details

After seller identity bootstrap, the buyer should fetch the full slot payload
from the seller agent itself.

Primary helper:

- `skills/placement-scout/scripts/fetch_slot_details_from_seller.mts`

The tracking backend is no longer the canonical placement-details source for the
buyer flow.

### Seller A2A calls

The buyer is mostly an A2A client. It should call seller agents with
JSON-RPC `message/send` and these skill names:

- `negotiate-placement`
- `receive-campaign`
- `confirm-booking`
- `receive-payment-ticket`
- `cooperative-close`

### Playwright verification tools

The buyer should run this verification sequence before opening payment and during
streaming re-checks:

- `browser_navigate`
- `browser_scroll_to_element`
- `browser_wait_for`
- `browser_evaluate`
- `browser_network_requests`
- `browser_take_screenshot`

### Local signing helpers

The buyer should use these local helpers:

- `scripts/ensure_memory_state.mts`
- `scripts/upsert_placement.mts`
- `scripts/append_conversation_event.mts`
- `scripts/sign_tx.mts`
- `scripts/sign_coop.mts`
- `scripts/sign_ticket.mts`
- `scripts/sign_and_submit.mts`
- `skills/placement-scout/scripts/resolve_seller_endpoint.mts`
- `skills/placement-scout/scripts/fetch_slot_details_from_seller.mts`
- `skills/placement-scout/scripts/negotiate_placement.mts`
- `skills/placement-scout/scripts/register_tracking_booking.mts`
- `skills/placement-scout/scripts/send_campaign_handoff.mts`

## 5. Memory Model

### `placements.json`

Each placement entry should group related state:

- `state`
- `discovery`
- `slot_details`
- `conversation`
- `negotiation`
- `delivery`
- `verification`
- `payment_channel`
- `payments`
- `tasks`
- `manual_submission_deadline`

Identity rule:

- `discovery.placement_id` is the current BookingSpace locator for discovery and first contact only
- once the seller assigns `conversation.context_id`, that becomes the durable conversation identifier
- once the payment channel exists, `payment_channel.channel_id` and `payment_channel.channel_tx_hash` become the durable payment identifiers
- buyer-side campaign performance should use `delivery.booking_id`

### Allowed states

The buyer placement state machine is:

- `negotiating`
- `awaiting_publication`
- `verifying`
- `channel_open`
- `streaming`
- `closing`
- `disputed`
- `closed`

## 6. Heartbeat Checklist

The heartbeat loop should:

- load `placements.json`
- process each placement by state
- recompute total spend
- optionally discover new placements if budget remains
- write daily reports if the UTC day rolled over

### State: `negotiating`

Entry condition:

- buyer created a placement entry after discovery and sent the first negotiation message

Actions:

- wait for seller response to `negotiate-placement`
- if seller returns `contextId`, persist it immediately
- append request and response to `memory/conversations/{contextId}.json`
- if price is acceptable, continue to tracking registration and campaign handoff
- if seller rejects or counter exceeds budget, mark placement `closed`

Memory updates:

- set `context_id`
- set `agreed_price_per_mille` when accepted
- keep `state = negotiating` until creative handoff begins

### State: `awaiting_publication`

Used only for manual publication mode.

Actions:

- poll seller task `task_ids.campaign_handoff`
- if completed, extract `live_url` and `element_id`
- move to `verifying`
- if deadline passes, mark the placement failed and close it

Memory updates:

- set `live_url`
- set `element_id`
- set `state = verifying` or `closed`

### State: `verifying`

Actions:

- run Playwright verification
- ensure the expected image is present
- ensure the element is visible and matches expectations
- ensure the tracking pixel/request fired
- save screenshot evidence

If verification succeeds:

- build and submit settlement tx
- persist `channel_tx_hash`, `channel_index`, `channel_id`, `total_udt_locked`
- send `confirm-booking` to the seller
- store returned task id and any refreshed seller-side placement locator
- move to `channel_open`

If verification fails:

- send seller a warning message with the failure reason
- increment `verification_failures`
- if failures reach threshold, close and dispute if funds are at risk

### State: `channel_open`

Actions:

- poll seller task `task_ids.channel_open_confirm`
- re-check placement on-chain to confirm it references the opened channel
- if confirmed, move to `streaming`
- if seller does not confirm for too long, resend `confirm-booking`

Memory updates:

- set `last_verified_at`
- set `state = streaming` when slot confirmation is complete

### State: `streaming`

This is the primary revenue loop.

Actions each cycle:

- call `check_placement.mts`
- read impressions and clicks
- re-run Playwright verification
- if verification fails, skip payment this cycle and warn seller
- compute cumulative owed amount:
  `seller_claim = impressions * agreed_price_per_mille / 1000`
- if `seller_claim > last_ticket_seller_claim`, sign and send a new ticket
- update spend totals
- detect underperforming placements
- detect missing seller ACKs
- initiate close if budget is exhausted or campaign should end

Memory updates:

- update `last_ticket_seller_claim`
- update `last_ticket_timestamp`
- update `last_ticket_sig`
- update `last_verified_at`
- append to ticket log

### State: `closing`

Actions:

- poll cooperative close task
- if seller returns `seller_sig`, rebuild final coop tx and submit it
- if timeout expires, fall back to dispute

Memory updates:

- set `state = closed` after coop close submit
- or set `state = disputed` after fallback

### State: `disputed`

Actions:

- wait until dispute window expires
- build and submit payout claim

Memory updates:

- store `dispute_tx_hash`
- store `dispute_submitted_at`
- set `state = closed` after payout claim

### State: `closed`

Actions:

- no operational work
- include in reports

## 7. Discovery Loop Checklist

The buyer should continue discovering placements while:

- there is remaining budget
- active placements are below the configured cap

For each new candidate:

- skip if already present in `placements.json`
- skip if `gateway_url` is missing
- fetch seller card
- verify seller pubkey match
- fetch verified placement details
- evaluate compatibility with campaign requirements
- create `correlation_id`
- create placement record with `context_id = null`
- send first `negotiate-placement` request without `contextId`

## 8. A2A Contract Checklist

### First message to seller

The first `negotiate-placement` request must:

- omit `contextId`
- include `correlationId`
- include placement id, offered price, buyer identity, and buyer A2A URL

### Subsequent messages

Every later message must include:

- `contextId`
- the correct `skill` payload

### Seller responses the buyer must parse

The buyer should handle:

- immediate `result.message` responses for negotiation
- `result.task` responses for campaign handoff and booking confirmation
- coop close task completion artifacts containing `seller_sig`

## 9. Owner-Facing Control Surface

The backend already supports owner chat and owner command transport through:

- `POST /campaigns/:id/chat`
- `POST /campaigns/:id/command`

Recommended buyer command handlers:

- `update_settings`
- `pause_campaign`
- `resume_campaign`
- `close_placement`
- `close_all`
- `report_now`

Recommended owner-safe mutations:

- `max_price_per_mille`
- `keyword_flags`
- `creative`
- pause or resume intent

The buyer must not let seller-originated A2A traffic change these values.

## 10. Daily Reporting Checklist

At the end of each heartbeat cycle:

- sum impressions across placements
- sum spend from `last_ticket_seller_claim`
- sum clicks from tracking stats
- compute CTR
- write `memory/reports/daily/YYYY-MM-DD.json`
- update `memory/stats.json`

## 11. Failure Handling Rules

The buyer must:

- never open payment before successful live verification
- never exceed `totalBudgetUdt`
- never send a payment ticket for an unverified cycle
- never regress `seller_claim_udt`
- never regress `ticket_timestamp`
- never trust seller free-text over the structured `skill` contract
- never mutate campaign config from seller A2A input

Fallback rules:

- negotiation rejected: close placement candidate
- manual publication deadline missed: close the placement
- repeated verification failure: close and consider dispute if channel already exists
- seller ACK timeout: re-verify once, resend ticket if still live, otherwise dispute
- cooperative close timeout: dispute
- payout too early: compute deadline and retry later

## 12. Current Gaps To Resolve During Implementation

- Tracking URL semantics are inconsistent between buyer docs and backend route mounting.
- `confirm-booking` should persist the refreshed seller-side placement locator when the seller returns it, since the BookingSpace cell outpoint changes after booking.
- The source `.mts` template scripts are now present, but they are copied from
  compiled output and should eventually be rewritten into cleaner source form.

## 13. Suggested Build Order

Implement the buyer in this order:

1. memory load and save helpers
2. discovery plus seller resolution
3. negotiation flow and conversation persistence
4. tracking registration and campaign handoff
5. Playwright verification
6. payment channel open and seller confirmation
7. streaming ticket loop
8. cooperative close
9. dispute and payout recovery
10. reporting and owner commands
