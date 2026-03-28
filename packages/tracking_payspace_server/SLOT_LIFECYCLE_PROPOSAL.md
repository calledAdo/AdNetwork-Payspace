# Proposed Change: Publisher Slot Installation and Readiness

This document proposes the next backend and product change for publisher slot
creation.

It addresses one core gap in the current system:

- a slot record can exist before the snippet is actually installed on the
  publisher's page

That means we can create a seller slot, spawn/sync the seller agent, and even
prepare snippet assets before we have confidence that the slot is truly live on
the website.

## Goals

- keep publisher onboarding separate from slot creation
- keep campaign onboarding separate from both publisher flows
- keep `SellerSlotDetails` as the one canonical seller slot record
- make snippet installation a first-class lifecycle step
- avoid using impressions as the main proof of snippet installation
- keep seller agent Playwright-free for now
- use gateway admin routes for rich agent-memory inspection in dashboards
- make backend/tracking explicitly tell the seller agent when a slot is ready

## Current Flow

Today the effective flow is:

1. publisher creates a `SellerProfile`
2. publisher creates a slot with `POST /publishers/:ownerPubkey/slots`
3. backend writes `slot_details/{snippet_id}.json`
4. backend ensures the seller agent exists
5. backend sends `register_slot` to the seller agent
6. snippet content can later be updated and served by tracking routes
7. publishing readiness is still implicit instead of being explicitly signaled

What is missing is the explicit step between:

- "slot details exist"
- and "the snippet is actually installed and live on the target page"

## Canonical Records

The canonical records should be:

- `SellerProfileInit`
  Used only for publisher onboarding input
- `SellerProfile`
  Persisted publisher profile
- `SellerSlotInit`
  Used only for slot-creation input
- `SellerSlotDetails`
  Persisted slot record and the exact payload sent to the seller agent
- `CampaignInit`
  Used only for campaign onboarding input
- `CampaignCore`
  Persisted buyer campaign business record

There should not be a second separate slot-details business type in tracking.
`SellerSlotDetails` is the one slot record. Tracking may extend or read around
it, but should not redefine it.

## Proposed Slot Lifecycle

### 1. Publisher Onboarding

This remains unchanged conceptually:

- assistant derives `SellerProfileInit`
- frontend submits `POST /publishers`
- backend persists `SellerProfile`

This flow only creates the publisher profile.

It does not create a slot.

### 2. Slot Creation

After the publisher is onboarded:

- assistant derives `SellerSlotInit`
- frontend submits `POST /publishers/:ownerPubkey/slots`
- backend creates `SellerSlotDetails`
- backend generates `snippet_id`
- backend returns installation artifacts to the frontend
- backend ensures seller agent exists
- backend sends `register_slot` with the full `SellerSlotDetails` payload

Important:

- slot creation should not imply the slot is already live
- it only means the slot is defined, stored by the seller agent, and ready for
  installation

### 3. Installation Phase

After slot creation, the publisher should be shown:

- `snippet_id`
- `loader_url`
- `embed_html`
- installation instructions

The publisher then places the snippet on the target `page_url`.

This is a real part of the workflow, not a silent assumption.

### 4. Readiness Phase

The platform should then detect that the snippet has actually loaded on the
publisher page.

Recommended order of trust:

1. snippet heartbeat
2. impressions only as weak supporting evidence
3. backend-to-seller publish signal

## Why Impression Count Should Not Be the Main Gate

Using `impressions >= 1` as the main installation proof is too weak:

- a valid installed snippet may get no traffic yet
- impression is a campaign metric, not an installation metric
- installation health and ad-delivery performance are different concerns

Impressions can help confirm that the slot is active later, but they should not
be the main readiness signal.

## Proposed Verification Signals

### A. Primary Signal: Snippet Heartbeat

Add a dedicated tracking route for snippet liveness, for example:

- `POST /tracking/snippet-seen`
  or
- `GET /tracking/snippet-seen?snippet_id=...`

The loader should ping this route once when it initializes successfully.

This gives a clear answer to:

- "has the snippet loaded on a real page at least once?"

without mixing that signal into impression metrics.

### B. Supporting Signal: Impression Count

`snippet_id` metrics can still support trust:

- if impressions increase, the slot is obviously active

But this should remain secondary to the dedicated liveness signal.

## Proposed Status Model

Add an installation/readiness status to the slot record.

Recommended statuses:

- `awaiting_install`
  Slot exists, snippet has not been seen yet
- `publishing`
  Snippet was seen and backend has already sent `publish_slot` to the seller
  agent
- `disabled`
  Slot should not be served or discovered

## Proposed `SellerSlotDetails` Shape

The current business fields stay, but the record should grow a small lifecycle
section.

Suggested shape:

```ts
type SellerSlotDetails = {
  schema_version: 1;
  snippet_id: string;
  owner_pubkey: string;
  page_url: string | null;
  dimensions: string | null;
  min_amount_per_1000: string;
  ad_position: number;
  publication_mode: number;
  keyword_flags: string;
  policy_text: string | null;
  metadata: Record<string, unknown> | null;
  installation: {
    status: "awaiting_install" | "publishing" | "disabled";
  };
  created_at: string;
};
```

This keeps the slot business record lean while still making readiness explicit.
It intentionally does not persist:

- `loader_url`
- `embed_html`
- publication tracking fields
- `last_seen_at`
- `updated_at`

Those are either generated on the fly, held in agent memory, or belong to the
runtime layer rather than the business slot record.

## Proposed Backend Route Changes

### `POST /publishers/:ownerPubkey/slots`

Keep this as the canonical slot-creation route.

Change its response so the frontend immediately gets installation artifacts:

```json
{
  "slot": { "...": "..." },
  "install": {
    "snippet_id": "snip_xxx",
    "loader_url": "https://.../tracking/snippet/loader.js?id=snip_xxx",
    "embed_html": "<div ...></div><script ...></script>",
    "status": "awaiting_install"
  },
  "agent_status": "active"
}
```

### Add a Snippet Liveness Route

Add one of:

- `POST /tracking/snippet-seen`
- `GET /tracking/snippet-seen`

It should:

- accept `snippet_id`
- transition `awaiting_install -> publishing`
- immediately trigger a backend-to-seller owner command:
  - `publish_slot`

### Add Seller Publish Trigger

The backend should gain a simple orchestration step that tells the seller agent
to publish once readiness has been observed.

This can happen:

- directly inside the `snippet-seen` route after the first valid heartbeat
- or through a small internal helper that deduplicates publish requests

The intended sequence is:

1. snippet loader is seen
2. backend marks slot status as `publishing`
3. backend sends `publish_slot`
4. seller agent publishes the BookingSpace slot
5. agent-facing views may later reflect publication, but the backend slot record
   does not need to be updated again

## Proposed Seller Agent Behavior

The seller agent should still receive `register_slot` immediately after slot
creation so it holds the full slot details early.

But the seller agent should treat the slot as not yet ready for marketplace
exposure until installation has been confirmed.

That means:

- `register_slot` stores the slot in seller memory
- seller agent may help explain installation steps in owner chat
- seller agent should not publish the slot to BookingSpace discovery until the
  backend explicitly sends `publish_slot`
- `publish_slot` should mean:
  - the snippet has been seen live
  - now publish the BookingSpace slot on-chain

This avoids a race where buyers discover a slot that is not actually installed.

## Proposed Frontend Flow

### Publisher Onboarding

- assistant derives `SellerProfileInit`
- confirmation dialog appears
- frontend calls `POST /publishers`
- redirect to the new-slot flow

### New Slot Flow

- assistant derives `SellerSlotInit`
- confirmation dialog appears
- frontend calls `POST /publishers/:ownerPubkey/slots`
- frontend shows:
  - `snippet_id`
  - copyable `loader_url`
  - copyable `embed_html`
  - step-by-step installation guidance
- UI waits for publication progress

### Publisher Dashboard / Inventory

Inventory should show per-slot readiness:

- awaiting install
- publishing
- for actual publish/runtime state, read the seller agent admin view

## Gateway Admin and Detail Views

The deeper operational details should come from gateway admin routes, not by
overloading the public business record.

Useful gateway routes already exist in:

- `GET /agents/:agentId/metrics`
- `GET /agents/:agentId/conversations`
- `GET /agents/:agentId/conversations/:contextId`

These should power:

- seller slot detail pages
- operator views
- live booking and conversation inspection

The backend slot record should remain the business and readiness record.
The gateway routes should remain the runtime and memory-inspection layer.

## Recommended Build Order

1. extend `SellerSlotDetails` with installation status only
2. change `POST /publishers/:ownerPubkey/slots` to return installation artifacts
3. add `snippet-seen` tracking route and loader ping
4. trigger `publish_slot` once snippet liveness is observed
5. expose readiness in publisher inventory UI
6. make seller agent publish only after `publish_slot`

## Summary

The main change is to stop treating slot creation as the same thing as slot
readiness.

The new intended model is:

- publisher onboarding creates the seller profile
- slot creation creates the seller slot definition and snippet assets
- snippet installation is detected by the tracking layer
- backend tells the seller agent when the slot is ready
- the seller agent then owns the actual publication step and its ongoing state

That gives us a much cleaner system for publishers, buyers, dashboards, and
seller agent behavior.
