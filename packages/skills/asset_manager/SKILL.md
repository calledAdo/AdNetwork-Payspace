---
name: asset_manager
description: Shared asset movement skill for CKB and xUDT transfers and owner-directed withdrawals.
---

# Skill: asset_manager

This skill owns asset movement through the MCP transaction builders.

## Possible Tasks

- build a plain CKB transfer
- build an xUDT transfer
- prepare a withdrawal back to an owner
- prepare treasury movement between agent-controlled locks

## Scripts

- `scripts/build_withdraw_ckb.mjs`
  Build a plain CKB transfer for fuel withdrawal.
  Accepts `--from`, `--to`, `--amount`.

- `scripts/build_withdraw_token.mjs`
  Build an xUDT transfer for token withdrawal.
  Accepts `--from`, `--to`, `--amount`, `--udt-type-args`.

## How The Scripts Work Together

- `build_withdraw_ckb.mjs` is the plain CKB path
- `build_withdraw_token.mjs` is the xUDT path
- both are builder-level helpers and can be paired with `native_signer` for
  signing and submission

## Best Practices

- always inspect the `fuel` block in the build response before signing
- keep plain CKB and xUDT flows as separate explicit operations
- return the exact MCP build error to the caller rather than narrative summaries
