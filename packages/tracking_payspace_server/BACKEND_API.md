# PaySpace Backend API (Tracking-Only)

This backend is now a tracking-only service.

## Active Scopes

- `/tracking/*`
- `/snippets/*`

All previous onboarding/orchestration scopes (`/publishers`, `/campaigns`,
`/assistant`, `/gateway-nodes`, `/agent-bindings`) are deprecated and return
`410 Gone`.

## Route Mounts

Defined in `src/app.ts`:

- `GET /health`
- `GET|POST /tracking/*`
- `GET|POST /snippets/*`

## Tracking Endpoints

Defined in `src/routes/tracking.ts`.

- `POST /tracking/bookings/register`
  - register booking tracking
  - returns `booking_id`, `tracked_image_url`, `tracked_click_url`

- `GET /tracking/image`
  - increments impression counters for `snippet_id` and/or `booking_id`
  - redirects to booking image URL if present; otherwise returns transparent PNG

- `GET /tracking/click`
  - increments click counters for `snippet_id` and/or `booking_id`
  - with `ping=1` returns `204`
  - otherwise redirects to destination URL

- `GET /tracking/stats/:id`
  - fetches metrics by metric id (`snippet_id` or `booking_id`)
  - returns impressions, clicks, CTR, geo counters

- `POST /tracking/snippet-content`
  - compatibility endpoint for signed snippet updates
  - accepts legacy aliases:
    - `action_url` -> `destination_url`
    - `write_up` -> `writeup`

- `GET /tracking/snippet/loader.js?id=<snippet_id>`
  - serves embeddable loader JavaScript

- `GET /tracking/snippet/:id`
- `GET /tracking/slot-details/:id`
  - snippet detail views (same tracking payload format)

Deprecated in tracking scope:

- `GET|POST /tracking/snippet-seen` -> `410 Gone`
- `DELETE /tracking/snippet/active` -> `410 Gone`

## Snippet Endpoints

Defined in `src/routes/snippets.ts`.

- `POST /snippets`
  - creates standalone snippet
  - server generates `snippet_id`
  - request supports:
    - `owner_pubkey` (optional)
    - `signer_policy`: `owner | seller_agent` (optional, default `owner`)
    - `dimensions` (optional)
    - `lifecycle_status`: `active | inactive` (optional, default `inactive`)

- `GET /snippets/:id`
  - returns merged snippet record metadata + content, loader URL, and embed HTML

- `POST /snippets/:id/content`
  - signed content update
  - canonical content fields:
    - `image_url`
    - `destination_url`
    - `writeup`
  - optional metadata patch in same request:
    - `dimensions`
    - `lifecycle_status`

## Signer Policy

Implemented in `src/plugins/default/snippet.ts`.

- `owner` policy:
  - signature must verify against `owner_pubkey`
- `seller_agent` policy:
  - signature must verify against `seller_profiles[owner_pubkey].agent_pubkey`

## Data Collections (File Store)

Stored via `src/store.ts`:

- `snippets/<snippet_id>.json` — snippet manifest metadata
- `snippets/<snippet_id>.json` — merged snippet metadata + mutable content
- `bookings/<booking_id>.json` — booking tracking registration
- `metrics/<metric_id>.json` — counters for snippets/bookings

