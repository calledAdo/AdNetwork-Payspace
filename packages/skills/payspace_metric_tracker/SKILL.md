---
name: payspace_metric_tracker
description: Create booking tracking spots, fetch metrics, and manage snippets through tracking_payspace_server.
---

# Skill: payspace_metric_tracker

This skill is a thin client over `tracking_payspace_server` tracking/snippet routes.

## Possible Tasks

- create a booking tracking spot that masks destination and image URLs
- fetch metrics by `booking_id` or `snippet_id`
- create standalone snippets with tracking capability
- fetch snippet/slot tracking details
- submit signed snippet content updates

## Scripts

- `scripts/create_booking_spot.mjs`
  register a booking (`/tracking/bookings/register`) and return tracked URLs

- `scripts/get_metrics.mjs`
  fetch counters + CTR (`/tracking/stats/:id`)

- `scripts/create_snippet.mjs`
  create standalone snippet (`/snippets`), backend returns generated `snippet_id`
  (status defaults to `inactive` and is backend-managed)

- `scripts/get_snippet.mjs`
  fetch snippet details (`/snippets/:id`)

- `scripts/update_snippet_content.mjs`
  sign and submit snippet content (`/snippets/:id/content`)
  (content-only update; status is not client-provided)

## Signature Spec (snippet content updates)

`update_snippet_content.mjs` uses secp256k1 ECDSA and must match backend verification:

- message hash: `sha256(canonicalize(payload))`
- canonicalize: recursively sort object keys lexicographically
- sign call: `secp256k1.sign(hashBytes, privateKey, { prehash: false, format: "recovered" })`
- encoded signature sent to backend: `0x` + `r(32) || s(32) || recovery_id(1)`

The signature proves the caller controls the valid signing key for that snippet's signer policy.

## Status Ownership

- snippet `status` is owned by `tracking_payspace_server`
- newly created snippets start as `inactive`
- backend flips snippet to `active` on impression ping (`/tracking/image`)
- clients/agents do not set status in create or signed content update requests

