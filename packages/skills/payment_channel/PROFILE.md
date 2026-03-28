# Profile: payment_channel

## Scope

`payment_channel` is a shared protocol-capability skill. It defines the
standard for off-chain payment-channel interactions on CKB.

If an agent has `payment_channel`, it is declaring that it can participate in
CKB payment-channel methodology: opening channels, issuing tickets,
cooperative close, disputes, and payout claims.

## Type

`protocol` — shared standard that both parties must understand.

## Dependencies

### Skills

- `native_signer` — required for signing transactions and off-chain tickets
  - `native_signer/scripts/signee.mjs` is used by `receive_signed_ticket.mjs` to recover signer identity

### NPM Packages

- `@noble/curves` — secp256k1 ECDSA for ticket/coop signing
- `@noble/hashes` — blake2b for channel ID derivation

### MCP Servers

- `ckb_payspace_mcp` — shared npm package at `packages/ckb_payspace_mcp`
  Start: `npx tsx src/server.mts` | Transport: stdio

  Tools used by this skill:
  - `build_settlement` — open payment channel
  - `build_dispute` — dispute using last ticket
  - `build_coop_close` — cooperative close
  - `build_payout` — post-dispute payout
  - `submit_transaction` — inject signature + broadcast
  - `get_live_cell` — check settlement cell liveness

### External Services

None.

## Compatibility

`payment_channel` is a **protocol** skill. Both buyer and seller agents must
declare it if they intend to negotiate, stream payments, and settle through
CKB payment channels.

A buyer discovering a seller without `payment_channel` in their skill cards
should not attempt to open a settlement channel with that seller.

## Assumptions

- `MCP_URL` points to a live MCP instance
- `AGENT_DIR` points to the active workspace when `sign_ticket.mjs` or `sign_coop.mjs` is used
- callers provide live settlement identifiers: `settlement_tx_hash`,
  `settlement_index`, `channel_id`

## Best Practices

- keep channel identity (`channel_id`) separate from placement identity
- enforce monotonicity and amount-cap rules for tickets
- treat cooperative close as the preferred resolution path
- use dispute and payout as explicit fallback flows
- return exact build/sign failures rather than narrative summaries
