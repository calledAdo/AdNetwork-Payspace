---
name: native_signer
description: Shared secp256k1 transaction signing and build-sign-submit convenience helpers.
---

# Skill: native_signer

This skill provides local cryptographic key utilities and transaction signing.

## Possible Tasks

- sign a raw transaction signing message
- recover signer identity from a signed message
- derive blake160 lock args from a compressed secp256k1 pubkey
- generate an agent keypair (pubkey + blake160)
- build, sign, and submit a transaction in one step

## Scripts

- `scripts/derive_blake160.mjs`
  Derives CKB blake160 from a compressed secp256k1 pubkey.
  Returns `{ blake160 }`.

- `scripts/gen_keypair.mjs`
  Generates a secp256k1 keypair, writes `keyfile`/`pubkey`, and returns
  `{ pubkey, blake160 }`.

- `scripts/sign_tx.mjs`
  Signs a hex-encoded message with a secp256k1 private key from
  `PRIVATE_KEY` environment variable.
  Returns `{ signature }`.

- `scripts/signee.mjs`
  Recovers the signer `{ pubkey, blake160 }` from a 32-byte message and a
  65-byte secp256k1 signature (r||s||recovery_id).

- `scripts/sign_and_submit.mjs`
  Combined helper that calls a build endpoint, signs the returned
  `signing_message`, and submits the completed transaction.
  Accepts `--build-url`, `--submit-url`, and `--body`.

## How The Scripts Work Together

- `derive_blake160.mjs` and `gen_keypair.mjs` are identity primitives
- `sign_tx.mjs` is the low-level transaction signing primitive
- `sign_and_submit.mjs` wraps the full lifecycle for convenience when the caller
  does not need to inspect or modify the built transaction between steps

## Best Practices

- prefer `sign_tx.mjs` when you need to inspect the build response before signing
- prefer `sign_and_submit.mjs` for straightforward one-shot operations
- always check the build response `fuel` block before proceeding to sign
