# Profile: payspace_metric_tracker

## Scope

`payspace_metric_tracker` provides backend-facing tracking utilities:

- booking registration with tracked image/click URLs
- metrics reads for any metric id (`snippet_id` or `booking_id`)
- standalone snippet creation and retrieval
- signed snippet content updates

Snippet status behavior:

- status defaults to `inactive` on create
- activation is managed by backend impression flow
- scripts do not send client-side status fields

## Type

`capability` — agent-local operational client for `tracking_payspace_server`.

## Dependencies

### Skills

- `native_signer` (optional alternative) if signature is delegated externally

### NPM Packages

- `@noble/curves` — secp256k1 signing

### External Services

- `tracking_payspace_server` (default `http://localhost:4000`)
  - `/tracking/bookings/register`
  - `/tracking/stats/:id`
  - `/snippets`
  - `/snippets/:id`
  - `/snippets/:id/content`

