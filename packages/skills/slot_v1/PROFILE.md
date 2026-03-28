# Profile: slot_v1

## Scope

`slot_v1` covers the BookingSpace seller-side slot lifecycle:

- build publish, book, and unbook BookingSpace transactions

## Type

`protocol` — both buyer and seller agents should declare it for compatibility.

## Dependencies

### Skills

- `native_signer` — required for signing publish/book/unbook transactions

### MCP Servers

- `ckb_payspace_mcp` — shared npm package at `packages/ckb_payspace_mcp`
  Start: `npx tsx src/server.mts` | Transport: stdio

  Tools used:
  - discovery: `get_slot` / `discover_slots` (deployment dependent), `get_placement`, cell queries
  - lifecycle: `build_publish_placement`, `build_book_placement`, `build_cancel_booking`, `submit_transaction`

## Compatibility

Buyers should require sellers to advertise `slot_v1` if they expect:

- discoverable BookingSpace slots with `gateway_url` for A2A contact
- a consistent book/unbook lifecycle after settlement opens

