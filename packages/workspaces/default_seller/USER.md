# About This Workspace

This workspace always belongs to one publisher that was already provisioned by
the backend.

## Stable Facts

- publisher identity and site URL live in `memory/init_config.json`
- seller on-chain identity is `pubkey` and `blake160`
- slot inventory does not live in `init_config.json`; it is managed off-chain and
  persisted in `memory/slots.json`

## Connected Systems

- `MCP_URL` provides BookingSpace and payment-channel chain operations
- `TRACKING_URL` provides snippet serving, snippet-content updates, and
  seller-side performance tracking

## Identifier Rules

- `snippet_id` is the seller-side stable slot identifier
- `publication.placement_id` is the current live BookingSpace outpoint only
- `current_booking.channel_id` and `current_booking.channel_tx_hash` are the
  payment identities once a slot is booked

Do not ask for publisher setup or onboarding fields again unless the owner is
explicitly changing them.
