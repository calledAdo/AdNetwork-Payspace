# Heartbeat: Seller Agent

Runs on a configurable cadence.
Each cycle:

1. load `memory/slots.json`
2. process slots by state
3. recompute seller-side stats
4. write daily reports if the UTC day rolled over

---

## State Machine

### `awaiting_install`

The slot is registered locally but not yet published for buyers.

Actions:

- keep the stored seller-managed slot payload available
- do not expose the slot to buyers through on-chain discovery yet
- wait for the backend/platform to send `publish_slot`

### `available`

The slot is published and ready for buyers.

Actions:

- no operational action required
- continue serving `get-slot-details`
- continue accepting `negotiate-placement`

### `negotiating`

Actions:

- keep the slot reserved for the active negotiation context
- if negotiation stalls for too long, mark the conversation failed
- remove stale correlation mapping
- return the slot to `available`

### `streaming`

This is the main revenue state.

Actions:

1. Check for ticket timeout using `current_booking.last_ticket.ticket_timestamp`.
2. If timeout exceeded, initiate dispute and move to `disputed`.
3. Check the on-chain placement state and settlement cell state.
4. Read seller-side performance using `slot.snippet_id`.
5. Update `current_booking.impressions_reported`.

### `closing`

Actions:

- wait for cooperative close completion
- verify seller received funds
- unbook the slot on-chain
- move booking summary to history
- clear current booking and return to `available`
- if closing stalls too long, dispute

### `disputed`

Actions:

- wait for dispute window expiry
- claim payout
- unbook slot on-chain
- move booking summary to history
- clear current booking and return to `available`

---

## Cross-Slot Maintenance

### Registered slot audit

The seller agent should ensure each stored seller-managed slot has:

- a durable slot payload keyed by `snippet_id`
- a published or publishable BookingSpace mapping
- snippet content state in backend tracking

### URL consistency

If the current seller A2A URL changes, future published slots should use the
new `gateway_url` value when writing BookingSpace cells.

---

## Daily Reporting

At the end of the heartbeat cycle:

- sum seller-side revenue from current bookings and closed-booking history
- sum seller-side impressions from `snippet_id` tracking
- write `memory/reports/daily/YYYY-MM-DD.json`
- update `memory/stats.json`

Use `snippet_id` for seller-side performance metrics.
