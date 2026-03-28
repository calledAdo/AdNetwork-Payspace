# Profile: native_signer

## Scope

`native_signer` is a shared cryptographic signing skill. It provides secp256k1
identity/key primitives, transaction signing, and combined build->sign->submit
convenience helpers.

Any agent that needs to authorize CKB transactions locally should declare
`native_signer` as a required skill.

## Type

`capability` — agent-local signing ability.

## Dependencies

### Skills

None.

### NPM Packages

- `@noble/curves` — secp256k1 ECDSA
- `@ckb-ccc/core` — CKB hasher for blake160 derivation

### MCP Servers

- `ckb_chain`
  Required only by `sign_and_submit.mjs` which combines build + sign + submit.
  Endpoints used:
  - caller-provided `--build-url` (any MCP builder)
  - caller-provided `--submit-url` (typically `/transactions/submit` or `/placements/submit`)

  The MCP server must be reachable at the URL passed by the caller.

### External Services

None.

## Compatibility

`native_signer` is a local capability. It is not required on the counterparty.
Agents that use `payment_channel`, `slot_v1`, or `asset_manager` will
typically also require `native_signer`.

## Assumptions

- `PRIVATE_KEY` is available from dotenv or secure key management
- `gen_keypair.mjs` callers pass `--dir` to control key material output location
- signing material must never appear in markdown or logs

## Best Practices

- keep signing helpers stateless — they accept a message and return a signature
- keep key derivation and key generation in this skill, not protocol-specific skills
- use `sign_and_submit.mjs` only when the full cycle is desired
- never log or persist raw private keys
