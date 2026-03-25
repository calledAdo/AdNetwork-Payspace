# Payment Channel Lock Script

`payment-channel-lock` is the on-chain settlement contract for the Ad Network
protocol.

It implements a one-way UDT payment channel between:

- a buyer, who funds the channel
- a seller, who earns cumulative claim over time

Off-chain signed tickets move the channel state economically without touching
chain state for every impression cycle. The chain is only involved when:

- the channel opens
- the parties close cooperatively
- one side disputes
- the dispute is finally paid out

This contract is the settlement primitive that complements BookingSpace.

---

## Role in the Ad Network protocol

The BookingSpace contract tells the market:

- what slot exists
- whether it is available or taken
- which channel currently owns the slot

The payment-channel lock tells the market:

- how UDT is locked for that booking
- how buyer and seller claims are resolved
- how disputes are escalated
- how final payout is enforced

So:

- `booking-space-type` = inventory state
- `payment-channel-lock` = payment settlement state

---

## High-level purpose

This contract solves the problem of paying a seller incrementally without paying
on-chain for every delivery update.

It does that by using:

- an on-chain settlement cell that holds the locked UDT
- off-chain buyer-signed tickets that monotonically increase the seller claim
- either:
  - cooperative close
  - or dispute + payout

This gives:

- low on-chain overhead during normal operation
- recoverable payment state if one side stops cooperating

---

## Core model

The channel is one-way:

- buyer is the payer
- seller is the payee

The seller can only move claim upward over time.
There is no decrement path for the cumulative seller claim.

That means the core off-chain variable is:

- cumulative `seller_claim_udt`

not deltas.

---

## Lock args layout

The lock args are exactly `136` bytes.

They are split into:

- immutable channel identity
- mutable dispute state

### Immutable region

| Bytes | Field | Meaning |
|---|---|---|
| `[0..20)` | `seller_blake160` | seller identity |
| `[20..40)` | `buyer_blake160` | buyer identity |
| `[40..72)` | `standard_lock_code_hash` | lock code hash used for payout UDT cells |
| `[72..104)` | `channel_id` | unique channel id derived from first input outpoint |

### Mutable dispute region

| Bytes | Field | Meaning |
|---|---|---|
| `[104..112)` | `dispute_start_time` | `u64` unix seconds, `0` when channel is open |
| `[112..128)` | `seller_claim_udt` | `u128` cumulative seller claim |
| `[128..136)` | `ticket_timestamp` | `u64` monotonic ticket nonce |

Important:

- the first 104 bytes are immutable for the life of the channel
- only the final 32 bytes evolve through the dispute flow

---

## Channel ID

The `channel_id` is derived as:

- `blake2b("ckb-default-hash", first_input_tx_hash || first_input_index_LE4)`

Why this matters:

- it makes channels globally unique
- it prevents ticket replay across channels
- it gives BookingSpace a stable 32-byte identifier to store in
  `active_channel_id`

This is why:

- `active_channel_id` in BookingSpace

must be compared against:

- the derived `channel_id`

and **not** against the settlement/open tx hash.

---

## Off-chain ticket format

Each buyer-signed ticket is `56` bytes:

| Bytes | Field | Meaning |
|---|---|---|
| `[0..16)` | `seller_claim_udt` | cumulative seller claim, `u128 LE` |
| `[16..24)` | `ticket_timestamp` | monotonic nonce / timestamp, `u64 LE` |
| `[24..56)` | `channel_id` | 32-byte channel id |

The signing message is:

- `blake2b("ckb-default-hash", seller_claim || ticket_timestamp || channel_id)`

The signature is a secp256k1 signature verified against the buyer’s blake160.

This model is deliberately cumulative:

- seller claim must always increase
- timestamp must always increase

That means the latest valid ticket always dominates earlier tickets.

---

## Witness modes

The script dispatches behavior by witness lock length.

There are three modes.

### 1. Cooperative close

Witness length:

- `130` bytes

Layout:

- `buyer_sig(65) || seller_sig(65)`

Both parties sign:

- `blake2b("ckb-default-hash", seller_udt(16) || buyer_udt(16) || channel_id(32))`

This means both sides explicitly agree on the final split.

This mode is only valid when:

- `dispute_start_time == 0`

meaning the channel is still open and not already in dispute.

The contract also verifies:

- seller and buyer outputs match the agreed split
- the agreed split covers all UDT in the input channel cell

That last check is important because it prevents UDT leakage to a third output.

### 2. Dispute initiation / update

Witness length:

- `89` bytes

Layout:

- `seller_claim(16) || ticket_timestamp(8) || buyer_sig(65)`

The contract:

1. reconstructs the signed ticket message
2. verifies the buyer signature
3. enforces strict monotonicity if already disputed
4. rewrites the mutable dispute fields in output args:
   - `dispute_start_time = t_now`
   - `seller_claim_udt = new claim`
   - `ticket_timestamp = new timestamp`

This is how the seller pushes the latest buyer-authorized claim on-chain.

### 3. Post-dispute payout

Witness length:

- `0`

This mode is only valid when:

- `t_now >= dispute_start_time + 86400`

The contract then verifies:

- seller output equals stored `seller_claim_udt`
- buyer output gets the remainder
- seller and buyer output amounts sum exactly to channel input UDT

This finalizes the dispute.

---

## Channel lifecycle

The intended lifecycle is:

### Open

State:

- `dispute_start_time = 0`
- `seller_claim_udt = 0`
- `ticket_timestamp = 0`

Off-chain:

- buyer sends seller signed tickets over time

Possible exits:

- cooperative close
- dispute

### Disputed

State:

- `dispute_start_time > 0`
- seller claim and timestamp reflect latest proven ticket

Possible actions:

- submit a newer valid ticket to update dispute state
- wait 24 hours and then payout

### Closed

The channel is consumed and replaced by payout outputs.

At that point the BookingSpace slot can be released back to available state.

---

## Security properties

This contract provides several strong guarantees.

### 1. Buyer-authorized seller claim

The seller cannot invent a claim.
Any dispute update must include a valid buyer signature over:

- seller claim
- timestamp
- channel id

### 2. Strict monotonicity

When updating an existing dispute:

- claim must strictly increase
- timestamp must strictly increase

This prevents replaying older worse tickets.

### 3. Replay protection

`channel_id` is included in every signed ticket and cooperative close message.

That prevents:

- replaying a signature from another channel

even when buyer and seller are the same parties.

### 4. UDT conservation

The contract explicitly checks that payout outputs conserve the full UDT locked
in the channel.

This prevents silent leakage to extra outputs.

### 5. Deterministic dispute window

The dispute deadline is always:

- `dispute_start_time + 86400`

This is not stored separately, which keeps the state model small and auditable.

---

## Time model

Current time is read from:

- the first `header_dep`

The transaction builder must therefore include a recent canonical block header
when building dispute and payout flows.

The contract interprets:

- header timestamp in milliseconds
- converts to seconds

This keeps time checks deterministic inside the script.

---

## What the contract does **not** do

This lock script does not:

- discover placements
- verify ad delivery
- track impressions or clicks
- negotiate rates
- decide whether a seller claim is economically fair
- manage buyer or seller chat state

It only enforces:

- signature validity
- monotonic channel claim progression
- dispute timing
- payout correctness

That narrow focus is why it works well as a settlement primitive.

---

## Interaction with the rest of Ad Network

Typical full marketplace flow:

1. seller publishes BookingSpace slot
2. buyer discovers and negotiates
3. buyer opens settlement/payment channel
4. seller books the slot and writes `active_channel_id = channel_id`
5. buyer streams signed tickets off-chain
6. either:
   - both sides coop close
   - or one side disputes and final payout happens
7. seller releases the BookingSpace slot back to available

This contract governs steps 3, 5, 6, and indirectly 7.

---

## Error codes

The contract defines explicit script errors for:

- invalid arg length
- invalid witness shape
- invalid signatures
- cooperative close mismatches
- dispute monotonicity violations
- payout before deadline
- payout amount mismatches
- UDT conservation failures

These are defined in:

- [src/error.rs](./src/error.rs)

---

## Why this contract matters

Without this contract, Ad Network would need either:

- on-chain settlement for every payment update
or
- fully trust-based off-chain settlement

With this contract:

- most payment flow remains off-chain and cheap
- the latest valid claim can always be pushed on-chain
- the final payout is deterministic and enforceable

That makes `payment-channel-lock` the core economic settlement primitive of the
Ad Network protocol.
