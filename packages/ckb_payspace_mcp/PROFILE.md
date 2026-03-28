# Profile: ckb_payspace_mcp

## Scope

`ckb_payspace_mcp` is a standalone MCP server npm package that provides the
full on-chain PaySpace ad marketplace as Model Context Protocol tools. It
replaces the Express-based `packages/mcp` server.

All chain operations go through `@ckb-ccc/core` directly — no HTTP proxy.

## Type

`protocol` — this is the shared blockchain interface used by multiple skills.

## Dependencies

### NPM Packages

- `@ckb-ccc/core` — CKB blockchain client
- `@modelcontextprotocol/sdk` — MCP server framework
- `@noble/curves` — secp256k1 operations
- `blake2b` — hash functions
- `zod` — schema validation

### Skills

None — this is a foundational dependency that other skills build on.

## Tools Provided

### Transaction Builders (`payment_channel`, `asset_manager`)

| Tool | Description |
|---|---|
| `build_transfer` | Plain CKB transfer |
| `build_xudt_transfer` | xUDT token transfer |
| `build_settlement` | Open payment channel (lock buyer UDT) |
| `build_dispute` | Dispute using last signed ticket |
| `build_coop_close` | Cooperative close (agreed split) |
| `build_payout` | Payout after dispute window |
| `submit_transaction` | Inject signature + broadcast |

### Placement Builders (`slot_v1`)

| Tool | Description |
|---|---|
| `build_publish_placement` | Create BookingSpace cell |
| `build_book_placement` | Book a slot (seller marks taken) |
| `build_cancel_booking` | Unbook a slot (reset to available) |

### Cell Queries (all skills)

| Tool | Description |
|---|---|
| `get_live_cell` | Check cell liveness by outpoint |
| `get_cells_by_lock` | Find cells by secp256k1 lock |
| `get_cells_by_type` | Find cells by type script |
| `get_fuel_balance` | Spendable CKB fuel balance |
| `get_transaction` | Fetch tx by hash |
| `get_tip_header` | Latest block header |

### Discovery (`slot_v1`)

| Tool | Description |
|---|---|
| `discover_placements` | Scan on-chain available ad slots |
| `get_placement` | Fetch + decode a single placement |

## Agent Workflow

All tools that build transactions return a `signing_message`. The agent workflow:

1. Call a build tool (e.g. `build_settlement`)
2. Route the `signing_message` to `native_signer` skill
3. Receive the signature back
4. Call `submit_transaction` with the unsigned tx + signature

## Who Depends On This

- `payment_channel` — settlement, dispute, coop-close, payout, submit
- `slot_v1` — discover, publish, book, cancel
- `asset_manager` — transfer, xudt-transfer
- `slot_v1` — discover, cell queries
- `native_signer` — cell queries for key verification

## Starting The Server

```bash
npx tsx src/server.mts
```

Transport: **stdio** (standard MCP transport)
