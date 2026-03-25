//! # Payment Channel Lockscript
//!
//! A one-way UDT payment channel between a buyer (payer) and a seller (payee).
//! The buyer deposits UDT into a settlement cell; off-chain signed tickets
//! accumulate the seller's share without touching the chain.  Settlement is
//! either cooperative (instant) or unilateral via a dispute + payout flow.
//!
//! **Signature algorithm:** secp256k1 / blake160 (same as CKB's built-in
//! secp256k1 lock).  Signatures are verified inline using the `k256`
//! pure-Rust crate — no external auth module is required.
//!
//! ---
//!
//! ## Lock args layout (136 bytes)
//!
//! ```text
//!  ── Immutable (set at channel open, never change) ────────────────────────
//!  [0..20)    seller_blake160         blake160(compressed_seller_pubkey)
//!  [20..40)   buyer_blake160          blake160(compressed_buyer_pubkey)
//!  [40..72)   standard_lock_code_hash code_hash of the lock used for UDT output cells
//!  [72..104)  channel_id              blake2b("ckb-default-hash",
//!                                       first_input_tx_hash(32) || first_input_index(4))
//!                                     Globally unique; prevents cross-channel ticket replay.
//!
//!  ── Mutable dispute state (zeroed when channel is open) ──────────────────
//!  [104..112) dispute_start_time      LE u64  Unix timestamp (s) when dispute was initiated.
//!                                     0 = channel is open.
//!                                     Payout is valid at: t_now >= dispute_start_time + 86400
//!  [112..128) seller_claim_udt        LE u128 cumulative UDT the seller is claiming.
//!                                     u128 matches the sUDT standard (no truncation risk).
//!  [128..136) ticket_timestamp        LE u64  monotonically increasing nonce from the ticket.
//! ```
//!
//! The first 104 bytes are **immutable** for the lifetime of the channel.
//! The last 32 bytes are the **mutable dispute state** — updated atomically on
//! every dispute initiation or update.
//!
//! The buyer's signature is NOT stored in args.  It is supplied in the witness
//! of the dispute transaction, verified by the contract, and permanently
//! recorded on-chain as part of that transaction's witness data — available for
//! audit without consuming extra cell capacity.
//!
//! ---
//!
//! ## Off-chain payment ticket (56 bytes, signed by buyer)
//!
//! ```text
//!  [0..16)   seller_claim_udt   LE u128 cumulative UDT owed to seller so far
//!  [16..24)  ticket_timestamp   LE u64  monotonically increasing second-precision nonce
//!  [24..56)  channel_id         32 bytes
//! ```
//!
//! Signing message: `blake2b("ckb-default-hash", seller_claim(16) || ticket_timestamp(8) || channel_id(32))`
//!
//! Using u128 for the amount matches the sUDT standard and avoids any
//! truncation risk regardless of token denomination.
//!
//! The `channel_id` binding ensures a ticket signed for channel A cannot be
//! replayed against channel B, even when the same buyer and seller have multiple
//! concurrent channels open.
//!
//! ---
//!
//! ## Witness modes (dispatched by witness lock length)
//!
//! | Len | Mode               | Submitter    | Description                              |
//! |-----|--------------------|--------------|------------------------------------------|
//! | 130 | Cooperative close  | either party | Both parties agree on the final split    |
//! | 89  | Dispute / update   | either party | Submit a buyer-signed ticket on-chain    |
//! | 0   | Post-dispute payout| either party | Collect UDT after dispute window expires |
//!
//! ### Mode 1 — Cooperative close (witness = 130 bytes)
//!
//! ```text
//! witness[0..65)   buyer_sig   — secp256k1 sig by buyer
//! witness[65..130) seller_sig  — secp256k1 sig by seller
//! ```
//!
//! Both signatures are over:
//! `blake2b("ckb-default-hash", seller_udt(16) || buyer_udt(16) || channel_id(32))`
//!
//! where `seller_udt` and `buyer_udt` are u128 LE values read from the UDT
//! output cells (identified by `standard_lock_code_hash` + respective blake160).
//! Both parties explicitly commit to the exact split before the channel closes.
//! Only valid when `dispute_start_time == 0` (channel still open).
//!
//! **Cooperative close A2A flow:**
//! 1. Either party decides to close and constructs the tx with the desired UDT split.
//! 2. Compute `signing_message` and send to counterparty via A2A.
//! 3. Counterparty signs and replies.
//! 4. Either party submits with both signatures in the witness.
//!
//! ### Mode 2 — Dispute / update (witness = 89 bytes)
//!
//! ```text
//! witness[0..16)  seller_claim      LE u128 — UDT amount the seller is claiming
//! witness[16..24) ticket_timestamp  LE u64  — nonce from the buyer's ticket
//! witness[24..89) buyer_sig         65 bytes — buyer's secp256k1 signature for this ticket
//! ```
//!
//! The contract:
//! 1. Reconstructs the ticket message: `blake2b(seller_claim(16) || ticket_timestamp(8) || channel_id(32))`
//! 2. Verifies `buyer_sig` against `buyer_blake160` — confirms the buyer authorized this amount.
//! 3. If a dispute is already active (`dispute_start_time != 0`), enforces strict monotonicity:
//!    `new_seller_claim > current` AND `new_timestamp > current`.
//! 4. Enforces that the output cell args are identical to input args except the three mutable
//!    fields are updated atomically:
//!    - `dispute_start_time = t_now`  (resets the 24-hour window)
//!    - `seller_claim_udt = new_seller_claim`
//!    - `ticket_timestamp = new_ticket_timestamp`
//!
//! ### Mode 3 — Post-dispute payout (witness = 0 bytes)
//!
//! Valid only when `t_now >= dispute_start_time + DISPUTE_WINDOW_SECS`.
//! The contract checks:
//! - `seller_out == seller_claim_udt`
//! - `seller_out + buyer_out == total_udt_in`
//! - Both output cells are locked with `standard_lock_code_hash` + respective blake160.
//!
//! ---
//!
//! ## Channel lifecycle
//!
//! ```text
//! OPEN      dispute_start_time=0, seller_claim=0, ticket_ts=0
//!   │  (off-chain tickets flow from buyer to seller continuously)
//!   ├─ cooperative close (mode 1) ──────────────────────────────────► CLOSED
//!   └─ dispute initiation (mode 2)
//!        │  dispute_start_time = t_now
//!        │  seller_claim = ticket.seller_claim
//!        │  ticket_timestamp = ticket.timestamp
//!        │  (buyer_sig verified from witness, permanently in that tx)
//!        │
//! DISPUTED  dispute_start_time > 0, deadline = dispute_start_time + 86400
//!   ├─ dispute update (mode 2, newer ticket)
//!   │       dispute_start_time resets to t_now (new 24h window)
//!   │       three mutable fields updated ───────────────────────► DISPUTED
//!   └─ post-dispute payout (mode 3, t_now >= dispute_start_time + 86400)
//!        seller receives seller_claim_udt
//!        buyer receives remainder ────────────────────────────────► CLOSED
//! ```
//!
//! ---
//!
//! ## Time mechanism
//!
//! All time values are absolute Unix timestamps in **seconds**.
//! The current time is read from the transaction's first header dependency:
//!
//! ```rust,ignore
//! let t_now = load_header(0, Source::HeaderDep)?.raw().timestamp().unpack() / 1000;
//! ```
//!
//! The transaction builder must include a recent canonical block header hash in
//! `transaction.header_deps[0]`.  CKB validates the header exists on the
//! canonical chain before running the script.  This follows the same pattern
//! as the LendNerv vault lock contracts.
//!
//! The dispute window (`DISPUTE_WINDOW_SECS`) is 24 hours (86 400 s).
//! The deadline is always computed as `dispute_start_time + DISPUTE_WINDOW_SECS`
//! and is never stored — this keeps the args layout simple while still allowing
//! inspection of when the dispute started.

#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(any(feature = "library", test))]
extern crate alloc;

mod error;

use core::convert::TryInto;
use core::result::Result::{self, Err, Ok};

use ckb_std::ckb_types::prelude::*;
use ckb_std::{
    ckb_constants::Source,
    high_level::{
        load_cell_capacity, load_cell_data, load_cell_lock, load_cell_type_hash, load_header,
        load_script, load_witness_args,
    },
};

use error::Error;

// ─── Constants ────────────────────────────────────────────────────────────────

const ARGS_LEN: usize = 136;

// Immutable fields
const SELLER_BLAKE160_OFFSET: usize = 0;
const BUYER_BLAKE160_OFFSET: usize = 20;
const STANDARD_LOCK_OFFSET: usize = 40;
const CHANNEL_ID_OFFSET: usize = 72;

// Mutable dispute state fields
const DISPUTE_START_TIME_OFFSET: usize = 104;
const SELLER_CLAIM_OFFSET: usize = 112; // u128 — 16 bytes at [112..128)
const TICKET_TIMESTAMP_OFFSET: usize = 128; // u64  — 8 bytes at [128..136)

const SIG_LEN: usize = 65;
const COOP_WITNESS_LEN: usize = SIG_LEN * 2; // 130: buyer_sig || seller_sig
const DISPUTE_WITNESS_LEN: usize = 16 + 8 + SIG_LEN; //  89: claim(u128) || ts(u64) || buyer_sig

/// Dispute window: 24 hours in seconds.
const DISPUTE_WINDOW_SECS: u64 = 24 * 60 * 60;

// ─── Entry point ──────────────────────────────────────────────────────────────

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

pub fn program_entry() -> i8 {
    match run() {
        Ok(()) => 0,
        Err(e) => e as i8,
    }
}

fn run() -> Result<(), Error> {
    let script = load_script()?;
    let args = script.args().raw_data();
    if args.len() != ARGS_LEN {
        return Err(Error::InvalidArgsLength);
    }

    let seller_blake160: &[u8; 20] = args[SELLER_BLAKE160_OFFSET..SELLER_BLAKE160_OFFSET + 20]
        .try_into()
        .unwrap();
    let buyer_blake160: &[u8; 20] = args[BUYER_BLAKE160_OFFSET..BUYER_BLAKE160_OFFSET + 20]
        .try_into()
        .unwrap();
    let standard_lock_code_hash = &args[STANDARD_LOCK_OFFSET..STANDARD_LOCK_OFFSET + 32];
    let channel_id: &[u8; 32] = args[CHANNEL_ID_OFFSET..CHANNEL_ID_OFFSET + 32]
        .try_into()
        .unwrap();
    let dispute_start_time = read_u64_le(&args[DISPUTE_START_TIME_OFFSET..]);
    let seller_claim_udt = read_u128_le(&args[SELLER_CLAIM_OFFSET..]);
    let ticket_timestamp = read_u64_le(&args[TICKET_TIMESTAMP_OFFSET..]);

    let witness_args = load_witness_args(0, Source::GroupInput)?;
    let lock_bytes = witness_args
        .lock()
        .to_opt()
        .ok_or(Error::WitnessLockMissing)?
        .raw_data();

    match lock_bytes.len() {
        COOP_WITNESS_LEN if dispute_start_time == 0 => cooperative_close(
            seller_blake160,
            buyer_blake160,
            standard_lock_code_hash,
            channel_id,
            &lock_bytes,
        ),
        DISPUTE_WITNESS_LEN => initiate_or_update_dispute(
            &args,
            buyer_blake160,
            channel_id,
            dispute_start_time,
            seller_claim_udt,
            ticket_timestamp,
            &lock_bytes,
        ),
        0 if dispute_start_time != 0 => post_dispute_payout(
            seller_blake160,
            buyer_blake160,
            standard_lock_code_hash,
            dispute_start_time,
            seller_claim_udt,
        ),
        _ => Err(Error::InvalidWitness),
    }
}

// ─── Mode 1: Cooperative close ────────────────────────────────────────────────
//
// Witness: buyer_sig(65) || seller_sig(65)
// Both sign: blake2b(seller_udt(16) || buyer_udt(16) || channel_id(32))
// Only valid when dispute_start_time == 0 (channel is open).
//
// Security note: we check (seller_udt + buyer_udt) == total_udt_in rather than
// the weaker total_in == total_out.  The weaker check would allow a third output
// to drain UDT from the cell while conservation still holds.  By requiring the
// signed split to equal 100% of the input, no UDT can leave outside the two
// agreed outputs.

fn cooperative_close(
    seller_blake160: &[u8; 20],
    buyer_blake160: &[u8; 20],
    standard_lock_code_hash: &[u8],
    channel_id: &[u8; 32],
    witness: &[u8],
) -> Result<(), Error> {
    let sig_buyer = &witness[..SIG_LEN];
    let sig_seller = &witness[SIG_LEN..];

    let (seller_udt, buyer_udt) =
        collect_payout_outputs(seller_blake160, buyer_blake160, standard_lock_code_hash)?;

    // Both parties sign the agreed split as u128 LE — matches sUDT standard.
    let mut payload = [0u8; 16 + 16 + 32];
    payload[..16].copy_from_slice(&seller_udt.to_le_bytes());
    payload[16..32].copy_from_slice(&buyer_udt.to_le_bytes());
    payload[32..].copy_from_slice(channel_id);
    let msg = blake2b_256(&payload);

    verify_secp256k1(buyer_blake160, sig_buyer, &msg)?;
    verify_secp256k1(seller_blake160, sig_seller, &msg)?;

    // Verify the signed split covers ALL UDT in the cell (no leakage to a
    // third output).  seller_udt and buyer_udt are already u128, so no cast.
    let type_hash = load_cell_type_hash(0, Source::GroupInput)?.unwrap_or([0u8; 32]);
    let total_in = sum_udt_for_type(&type_hash, Source::GroupInput);
    if seller_udt + buyer_udt != total_in {
        return Err(Error::UdtConservationViolated);
    }

    Ok(())
}

// ─── Mode 2: Dispute initiation / update ──────────────────────────────────────
//
// Witness: seller_claim(16) || ticket_timestamp(8) || buyer_sig(65)  = 89 bytes
// Buyer signed: blake2b(seller_claim(16) || ticket_timestamp(8) || channel_id(32))
//
// The buyer_sig is verified here and permanently stored in this tx's witness.
// It is NOT copied into the output cell args — the witness record is sufficient.
//
// On success the output cell args are updated atomically (three mutable fields):
//   dispute_start_time = t_now   (resets the 24-hour window)
//   seller_claim_udt   = new claim (u128)
//   ticket_timestamp   = new timestamp

fn initiate_or_update_dispute(
    current_args: &[u8],
    buyer_blake160: &[u8; 20],
    channel_id: &[u8; 32],
    current_start_time: u64,
    current_seller_claim: u128,
    current_timestamp: u64,
    witness: &[u8],
) -> Result<(), Error> {
    let new_seller_claim = read_u128_le(&witness[..16]);
    let new_timestamp = read_u64_le(&witness[16..24]);
    let new_sig = &witness[24..]; // 65 bytes

    // 1. Verify the buyer's off-chain ticket signature.
    let mut payload = [0u8; 16 + 8 + 32];
    payload[..16].copy_from_slice(&new_seller_claim.to_le_bytes());
    payload[16..24].copy_from_slice(&new_timestamp.to_le_bytes());
    payload[24..].copy_from_slice(channel_id);
    let ticket_msg = blake2b_256(&payload);

    verify_secp256k1(buyer_blake160, new_sig, &ticket_msg)?;

    // 2. If updating an existing dispute, the new ticket must be strictly higher
    //    on both axes (this is a 1-way channel — amounts only go up).
    if current_start_time != 0 {
        if new_seller_claim <= current_seller_claim {
            return Err(Error::TicketNotHigherThanCurrent);
        }
        if new_timestamp <= current_timestamp {
            return Err(Error::TicketTimestampNotNewer);
        }
    }

    // 3. Build the expected output args: immutable prefix unchanged,
    //    three mutable fields updated atomically.
    //    buyer_sig stays in the witness only — no need to bloat cell args.
    let t_now = get_current_timestamp()?;
    let mut expected_args = [0u8; ARGS_LEN];
    expected_args.copy_from_slice(current_args);
    write_u64_le(&mut expected_args[DISPUTE_START_TIME_OFFSET..], t_now);
    write_u128_le(&mut expected_args[SELLER_CLAIM_OFFSET..], new_seller_claim);
    write_u64_le(&mut expected_args[TICKET_TIMESTAMP_OFFSET..], new_timestamp);

    verify_dispute_output(&expected_args)?;

    Ok(())
}

// ─── Mode 3: Post-dispute payout ──────────────────────────────────────────────
//
// Witness: empty (0 bytes).
// Valid only when t_now >= dispute_start_time + DISPUTE_WINDOW_SECS.
// The deadline is never stored — it is always dispute_start_time + 86400.

fn post_dispute_payout(
    seller_blake160: &[u8; 20],
    buyer_blake160: &[u8; 20],
    standard_lock_code_hash: &[u8],
    dispute_start_time: u64,
    seller_claim_udt: u128,
) -> Result<(), Error> {
    let t_now = get_current_timestamp()?;
    if t_now < dispute_start_time + DISPUTE_WINDOW_SECS {
        return Err(Error::DisputeWindowNotExpired);
    }

    let type_hash = load_cell_type_hash(0, Source::GroupInput)?.unwrap_or([0u8; 32]);
    let total_in = sum_udt_for_type(&type_hash, Source::GroupInput);
    let (seller_out, buyer_out) =
        collect_payout_outputs(seller_blake160, buyer_blake160, standard_lock_code_hash)?;

    if seller_out != seller_claim_udt {
        return Err(Error::PayoutAmountMismatch);
    }
    // seller_out and buyer_out are already u128 — no cast required.
    if seller_out + buyer_out != total_in {
        return Err(Error::UdtConservationViolated);
    }

    Ok(())
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Verify a secp256k1/blake160 signature.
///
/// `sig_bytes` must be 65 bytes: `r(32) || s(32) || recovery_id(1)`.
/// Recovers the compressed public key, hashes with blake2b-160, and compares
/// to `blake160`.
fn verify_secp256k1(blake160: &[u8; 20], sig_bytes: &[u8], msg: &[u8; 32]) -> Result<(), Error> {
    use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};

    if sig_bytes.len() != SIG_LEN {
        return Err(Error::InvalidSignature);
    }

    let rec_id = RecoveryId::from_byte(sig_bytes[64] % 4).ok_or(Error::InvalidSignature)?;
    let sig = Signature::from_slice(&sig_bytes[..64]).map_err(|_| Error::InvalidSignature)?;
    let recovered = VerifyingKey::recover_from_prehash(msg, &sig, rec_id)
        .map_err(|_| Error::SignatureMismatch)?;

    // blake160 = first 20 bytes of blake2b-256(compressed_pubkey)
    let encoded = recovered.to_encoded_point(true);
    let hash = blake2b_256(encoded.as_bytes());
    if &hash[..20] != blake160 {
        return Err(Error::SignatureMismatch);
    }

    Ok(())
}

fn collect_payout_outputs(
    seller_blake160: &[u8; 20],
    buyer_blake160: &[u8; 20],
    standard_lock_code_hash: &[u8],
) -> Result<(u128, u128), Error> {
    let mut seller_amt = 0u128;
    let mut buyer_amt = 0u128;

    let mut i = 0;
    loop {
        let lock = match load_cell_lock(i, Source::Output) {
            Ok(l) => l,
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e.into()),
        };

        if lock.code_hash().as_slice() == standard_lock_code_hash {
            let args = lock.args().raw_data();
            if args.len() == 20 {
                let data = load_cell_data(i, Source::Output)?;
                // Read the full u128 sUDT balance — no truncation.
                let amt = if data.len() >= 16 {
                    read_u128_le(&data.as_ref())
                } else {
                    0
                };

                if args.as_ref() == seller_blake160 as &[u8] {
                    seller_amt += amt;
                } else if args.as_ref() == buyer_blake160 as &[u8] {
                    buyer_amt += amt;
                }
            }
        }
        i += 1;
    }
    Ok((seller_amt, buyer_amt))
}

fn verify_dispute_output(expected_args: &[u8]) -> Result<(), Error> {
    let out_script = load_cell_lock(0, Source::GroupOutput)?;
    if out_script.args().raw_data().as_ref() != expected_args {
        return Err(Error::DisputeOutputArgsMismatch);
    }

    let in_cap = load_cell_capacity(0, Source::GroupInput)?;
    let out_cap = load_cell_capacity(0, Source::GroupOutput)?;
    if in_cap != out_cap {
        return Err(Error::DisputeCapacityMismatch);
    }

    let in_type = load_cell_type_hash(0, Source::GroupInput)?;
    let out_type = load_cell_type_hash(0, Source::GroupOutput)?;
    if in_type != out_type {
        return Err(Error::DisputeOutputTypeMismatch);
    }

    Ok(())
}

fn sum_udt_for_type(type_hash: &[u8; 32], source: Source) -> u128 {
    let mut total = 0u128;
    let mut idx = 0;
    loop {
        match load_cell_type_hash(idx, source) {
            Ok(Some(h)) if &h == type_hash => {
                if let Ok(data) = load_cell_data(idx, source) {
                    if data.len() >= 16 {
                        total += read_u128_le(&data.as_ref());
                    }
                }
            }
            Ok(_) => {}
            Err(_) => break,
        }
        idx += 1;
    }
    total
}

fn blake2b_256(data: &[u8]) -> [u8; 32] {
    use blake2b_ref::Blake2bBuilder;
    let mut out = [0u8; 32];
    let mut hasher = Blake2bBuilder::new(32)
        .personal(b"ckb-default-hash")
        .build();
    hasher.update(data);
    hasher.finalize(&mut out);
    out
}

/// Returns the current Unix timestamp in seconds by reading the first header dep.
///
/// The transaction builder must include a recent canonical block header hash in
/// `transaction.header_deps[0]`.  CKB validates that the referenced header
/// exists on the canonical chain before running the script.
fn get_current_timestamp() -> Result<u64, Error> {
    let header = load_header(0, Source::HeaderDep)?;
    Ok(header.raw().timestamp().unpack() / 1000) // ms → s
}

fn read_u64_le(b: &[u8]) -> u64 {
    u64::from_le_bytes(b[..8].try_into().unwrap_or([0u8; 8]))
}

fn read_u128_le(b: &[u8]) -> u128 {
    u128::from_le_bytes(b[..16].try_into().unwrap_or([0u8; 16]))
}

fn write_u64_le(b: &mut [u8], v: u64) {
    b[..8].copy_from_slice(&v.to_le_bytes());
}

fn write_u128_le(b: &mut [u8], v: u128) {
    b[..16].copy_from_slice(&v.to_le_bytes());
}
