---
description: Shared payment-channel protocol skill for opening channels, issuing tickets, cooperative close, disputes, and payout.
name: payment_channel
---

# Skill: payment_channel

This skill represents the shared payment-channel protocol capability.

## Possible Tasks

- build an open-channel transaction
- verify a channel is live
- build and sign a payment ticket
- recover the signer of a received ticket
- request cooperative-close signature from counterparty (via A2A transport)
- respond to a cooperative-close signature request (produce signature for same message fields)
- build a cooperative close
- build a dispute transaction
- build a payout transaction

## Scripts

- `scripts/build_open_channel.mjs`
  build the settlement/open-channel transaction
- `scripts/check_channel.mjs`
  read settlement cell liveness from MCP
- `scripts/sign_ticket.mjs`
  sign an off-chain payment ticket
- `scripts/receive_signed_ticket.mjs`
  recover the signer identity from a received ticket (recovery-only)
- `scripts/sign_coop.mjs`
  builds and signs the canonical cooperative-close hash from
  `seller_udt`, `buyer_udt`, and `channel_id`
- `scripts/build_close.mjs`
  build the cooperative-close transaction
- `scripts/build_dispute.mjs`
  build the dispute transaction
- `scripts/build_payout.mjs`
  build the final payout transaction

## How The Scripts Work Together

- `build_open_channel.mjs` starts the funded channel lifecycle
- `check_channel.mjs` verifies the settlement cell during ongoing operation
- `sign_ticket.mjs` creates the off-chain payment artifact used during streaming
- `receive_signed_ticket.mjs` reconstructs the ticket signing message and recovers the signer
- `sign_coop.mjs` is used by both request/response cooperative-close tasks; transport is routed by `messaging/a2a.mjs`
- `build_close.mjs` is used for cooperative close flows
- `build_dispute.mjs` and `build_payout.mjs` cover the fallback resolution path

## Notes

- `build_dispute.mjs` is the canonical dispute builder
- the old duplicate `build_initiate_dispute.mts` has been removed
