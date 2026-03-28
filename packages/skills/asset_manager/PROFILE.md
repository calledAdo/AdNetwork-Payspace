# Profile: asset_manager

## Scope

`asset_manager` is a shared asset movement skill for agents that need to move
plain CKB or xUDT balances to another lock.

It is not tied to buyer or seller identity. Any agent that advertises this
skill can prepare asset-withdrawal or asset-transfer transactions through the
MCP layer.

## Type

`capability` — agent-local asset movement ability.

## Dependencies

### Skills

- `native_signer` — required for signing the built transfer transactions

### NPM Packages

None beyond what `native_signer` provides.

### MCP Servers

- `ckb_payspace_mcp` — shared npm package at `packages/ckb_payspace_mcp`
  Start: `npx tsx src/server.mts` | Transport: stdio

  Tools used by this skill:
  - `build_transfer` — plain CKB transfer
  - `build_xudt_transfer` — xUDT token transfer
  - `submit_transaction` — inject signature + broadcast
  - `get_fuel_balance` — check spendable CKB balance

### External Services

None.

## Compatibility

`asset_manager` is a local capability. It is not required on counterparties.
Agents that hold on-chain assets and need owner-directed withdrawal capability
should declare this skill.

## Assumptions

- `MCP_URL` points to a live MCP instance
- lock args are passed explicitly by the caller
- the caller decides whether this is a withdrawal, treasury move, or owner payout

## Best Practices

- inspect the returned `fuel` block before continuing to sign
- keep plain CKB and xUDT transfer flows explicit and separate
- return the exact MCP build error to the caller
- keep this skill focused on asset movement only
