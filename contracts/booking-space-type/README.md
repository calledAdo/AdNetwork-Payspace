# BookingSpace Type Script

`booking-space-type` is the on-chain contract that represents a publisher ad
slot in the Ad Network protocol.

Its job is not to negotiate, track, or settle payments. Its job is much more
focused:

- define the canonical on-chain shape of a slot
- enforce which parts of a slot may change over time
- freeze booked slots while they are actively taken
- prevent destructive mutations that would break marketplace trust

In Ad Network terms, this contract is the on-chain inventory primitive.

---

## Role in the Ad Network protocol

The BookingSpace cell is the discovery and state anchor for seller inventory.

Each live BookingSpace cell represents one current on-chain slot instance.
That cell can be:

- available
- taken

The contract does **not** know:

- campaign details
- negotiation history
- tracking metrics
- seller CMS state
- buyer conversation state

Those live off-chain in the backend, gateway, and hosted agents.

What it *does* know is the structural state of the slot:

- seller identity
- price
- placement category / position
- publication mode
- keyword flags
- whether the slot is booked
- which payment channel currently owns the slot
- optional seller gateway endpoint
- optional off-chain details reference

---

## High-level purpose

This contract solves one core problem:

> how do we let a seller publish a mutable slot on-chain, while still preventing
> dangerous mutations once the slot is booked?

Its answer is:

- while the slot is **available**, only the seller identity is immutable
- while the slot is **taken**, the entire cell data is frozen
- a taken slot cannot be destroyed

That gives the marketplace a useful balance:

- sellers can update an available listing
- buyers can trust that an active booking cannot be silently altered

---

## Cell data layout

The BookingSpace cell data layout is fixed and byte-oriented.

### Mandatory section

Length: `92` bytes

| Bytes | Field | Meaning |
|---|---|---|
| `[0..33)` | `seller_pubkey` | 33-byte compressed secp256k1 public key |
| `[33..49)` | `price_per_mille` | `u128` little-endian, UDT units per 1000 impressions |
| `[49]` | `ad_position` | `u8`, placement category |
| `[50]` | `status` | `0 = available`, `1 = taken` |
| `[51]` | `publication_mode` | `0 = MANUAL`, `1 = SNIPPET_MANAGED` |
| `[52..60)` | `keyword_flags` | `u64` little-endian bitfield |
| `[60..92)` | `active_channel_id` | 32-byte payment-channel id, zeroed when available |

### Optional gateway section

| Bytes | Field | Meaning |
|---|---|---|
| `[92]` | `gateway_url_len` | byte length of UTF-8 gateway URL |
| `[93..93+N)` | `gateway_url` | seller A2A endpoint hint |

### Optional IPFS/details section

| Bytes | Field | Meaning |
|---|---|---|
| `[93+N]` | `ipfs_present` | `1` if details section exists |
| `[94+N..126+N)` | `details_cid` | 32-byte off-chain reference |
| `[126+N..158+N)` | `details_hash` | 32-byte hash of referenced off-chain details |

Important nuance:

- `details_cid` is a fixed-size contract field, not guaranteed to be a human
  CID string by itself
- the full details blob is always off-chain

---

## Meaning of the fields

### `seller_pubkey`

This is the permanent seller identity for the slot.

It is the one field that remains immutable even when the slot is still
available.

That means a seller cannot take over another seller's slot just by editing the
cell data while keeping the same lock.

### `price_per_mille`

On-chain listing price in UDT base units per 1000 impressions.

This is not a running payment balance. It is a slot listing parameter.

### `ad_position`

Encodes where the slot is on the page in marketplace terms, such as:

- banner
- sidebar
- native
- interstitial

### `status`

The core market state:

- `0` = available
- `1` = taken

This field drives the mutability policy enforced by the script.

### `publication_mode`

Describes whether delivery is:

- manual
- snippet managed

This is important for buyer/seller operational flows but the contract itself
just stores the value.

### `keyword_flags`

Bitfield describing topical categories for the slot.

This is how buyers filter relevant placements during discovery.

### `active_channel_id`

This is the current payment-channel identifier when the slot is taken.

Important:

- this is **not** the settlement transaction hash
- it is the 32-byte `channel_id`
- it comes from the payment-channel lock logic and is derived from the first
  input outpoint of the settlement/open transaction

This distinction matters because off-chain logic must compare:

- `booking_space.active_channel_id`
with
- the channel lock’s derived `channel_id`

not with the settlement tx hash.

### `gateway_url`

Optional seller gateway / A2A endpoint hint stored directly in the slot.

This is how buyers bootstrap seller-agent discovery from chain state.

### `details_cid` and `details_hash`

Optional off-chain reference and integrity hash.

The contract only stores the reference and hash. It does not interpret them
beyond bytes.

---

## Mutability model

This is the most important part of the contract.

The contract distinguishes three situations:

### 1. Creation

When a transaction creates BookingSpace outputs without consuming existing
BookingSpace inputs:

- every output must be at least `92` bytes
- otherwise creation is allowed

The contract assumes this is seller initialization of a new slot.

### 2. Update

When a transaction consumes and recreates BookingSpace cells one-to-one:

- input and output counts must match
- cells are paired by group index

Then each pair follows one of two rules:

#### If input `status == taken`

The output data must be byte-for-byte identical to the input.

This is the full freeze rule.

Once a slot is actively booked:

- price cannot change
- keyword flags cannot change
- gateway url cannot change
- details reference cannot change
- channel id cannot change except through a valid new cell transition outside
  this frozen state model

The slot is fully frozen while taken.

#### If input `status == available`

Only `seller_pubkey` must remain identical.

Everything else may change so long as:

- output length is still valid

This means sellers can update available listings without redeploying from
scratch.

### 3. Destruction

When BookingSpace inputs are consumed with no corresponding BookingSpace outputs:

- taken cells cannot be destroyed
- available cells may be destroyed

That means a seller cannot simply remove a live booked slot from the chain.

---

## Security properties

The script provides these guarantees:

### 1. Seller identity is durable

Even when available, a slot cannot silently change which seller it belongs to.

### 2. Active bookings are immutable

Once booked, the slot state is frozen.

This protects buyers from seller-side edits that would otherwise undermine trust
during a booking.

### 3. Taken slots cannot disappear

A seller cannot destroy a booked slot and claim it never existed.

### 4. Slot semantics remain simple

The contract does not try to do too much.
It only enforces:

- structure
- length
- mutability rules

This keeps it auditable and predictable.

---

## What the contract does **not** enforce

This script intentionally does **not** enforce:

- seller signatures
- who is allowed to mutate a cell
- tracking correctness
- snippet installation
- negotiation logic
- price fairness
- payment settlement correctness

Those responsibilities belong elsewhere:

- lock script controls authorization
- seller/buyer agents control negotiation and operations
- payment-channel lock controls settlement and dispute logic
- backend and tracking infrastructure handle delivery observability

---

## How it interacts with the payment-channel lock

The two contracts are linked through `active_channel_id`.

Typical lifecycle:

1. seller publishes BookingSpace slot with `status = 0`
2. buyer and seller agree off-chain
3. buyer opens settlement/payment channel
4. seller confirms booking and updates BookingSpace cell:
   - `status = 1`
   - `active_channel_id = derived channel_id`
5. later, when booking ends and channel closes, seller recreates slot:
   - `status = 0`
   - `active_channel_id = zero`

Because the BookingSpace cell is consumed and recreated, the **outpoint changes**
across these transitions.

This is why seller runtime memory must treat:

- `publication.placement_id`

as the **current live outpoint**, not a permanent slot identity.

---

## Why the outpoint changes matter

The slot’s stable seller-side identity is off-chain:

- usually `snippet_id`

The on-chain BookingSpace identity is:

- current outpoint
  `tx_hash:index`

So:

- buyers use `placement_id` for fresh discovery and initial contact
- sellers must update the current placement outpoint after publish/book/release
- stale outpoints should be treated as stale chain locators

This is an intended consequence of the CKB cell model.

---

## Error codes

The contract returns explicit script errors for:

- input data too short
- output data too short
- input/output count mismatch during update
- mutation of a taken cell
- mutation of `seller_pubkey` on an available cell
- destruction of a taken cell

These are defined in:

- [src/error.rs](./src/error.rs)

---

## Why this contract is useful

Without this script, a slot cell would just be arbitrary bytes protected only by
a lock.

With this script:

- the marketplace gains a standard slot model
- buyers can trust booking immutability
- sellers can still update available listings
- off-chain agent logic has a stable, auditable chain anchor

That makes `booking-space-type` the core inventory contract for Ad Network.
