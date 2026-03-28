# About This Workspace

This workspace always belongs to one advertiser campaign that was already
provisioned by the backend.

## Stable Facts

- campaign identity, budget, targeting, and creative live in
  `memory/init_config.json`
- owner wallet identity is `ownerPubkey`
- buyer on-chain identity is `pubkey` and `blake160`
- campaign creative is `creative.image_url`, `creative.click_url`, and
  optional `creative.write_up`

## Connected Systems

- `MCP_URL` provides BookingSpace discovery plus settlement-channel builders
- `TRACKING_URL` provides `/tracking/bookings/register` and
  `/tracking/stats/:id`
- `PLAYWRIGHT_MCP_URL` provides browser verification

## Identifier Rules

- `discovery.placement_id` is the current BookingSpace outpoint used for first
  seller contact
- `slot_details.snippet_id` is the seller-side slot identity and DOM target
- `delivery.booking_id` is the buyer-side performance identity
- `payment_channel.channel_id` and `payment_channel.channel_tx_hash` are the
  payment identities after settlement opens

Do not ask for campaign setup or onboarding fields again unless the owner is
explicitly changing them.
