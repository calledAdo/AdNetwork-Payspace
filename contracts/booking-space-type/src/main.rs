//! # BookingSpace Type Script
//!
//! Enforces mutability rules on BookingSpace cells — one cell per physical ad
//! slot on a publisher's site.
//!
//! ---
//!
//! ## Cell data layout
//!
//! ```text
//! ── Mandatory section (92 bytes) ────────────────────────────────────────────
//! [0..33)    seller_pubkey        33 bytes  compressed secp256k1 public key
//!                                           PERMANENTLY IMMUTABLE — even when available
//! [33..49)   price_per_mille      u128 LE   UDT base units per 1000 impressions (CPM)
//! [49..50)   ad_position          u8        0=banner, 1=sidebar, 2=native, 3=interstitial
//! [50..51)   status               u8        0=available, 1=taken
//! [51..52)   publication_mode     u8        0=MANUAL, 1=SNIPPET_MANAGED
//! [52..60)   keyword_flags        u64 LE    bitfield; bit 0=blockchain, 1=defi, 2=gaming, …
//! [60..92)   active_channel_id    32 bytes  payment-channel `channel_id`
//!                                           zeroed when available
//!                                           this is NOT the settlement tx hash;
//!                                           it is the 32-byte channel id derived by the
//!                                           payment-channel lock from the first input outpoint
//!
//! ── Optional: gateway URL (variable length, offset 92) ──────────────────────
//! [92..93)   gateway_url_len      u8        byte length of the URL (0 = no gateway)
//! [93..93+N) gateway_url          UTF-8     seller agent endpoint (N = gateway_url_len)
//!
//! ── Optional: IPFS section (offset 93+N, only present when appended) ────────
//! [93+N]     ipfs_present         u8        1=present; byte absent when no IPFS data
//! [94+N..)   details_cid (32) + details_hash (32)  when ipfs_present=1
//!                                           these 64 bytes are only a fixed-size off-chain
//!                                           details reference plus hash, not the details blob
//!                                           itself; full details are fetched off-chain
//! ```
//!
//! ---
//!
//! ## Mutability rules
//!
//! The type script runs on every transaction that consumes or creates a
//! BookingSpace cell.  Three operation modes are distinguished:
//!
//! **Creation** (`GroupInput` is empty, `GroupOutput` has N cells)
//! - Each output cell must be at least `MANDATORY_LEN` bytes.
//! - No further constraints — seller is initialising a fresh slot.
//!
//! **Update** (`GroupInput` count == `GroupOutput` count, both > 0)
//! - Cells are paired by their index within the group.
//! - For each pair:
//!   - If `input.status == 1` (taken): `output_data` must equal `input_data`
//!     byte-for-byte (full freeze — active booking prevents any change).
//!   - Else (`input.status == 0`, available):
//!     - `output_data[0..33)` must equal `input_data[0..33)` (seller_pubkey immutable).
//!     - `output_data` must be at least `MANDATORY_LEN` bytes.
//!
//! **Destruction** (`GroupOutput` is empty, `GroupInput` has N cells)
//! - A taken cell (status == 1) cannot be destroyed.
//! - Available cells may be destroyed — the lock script (seller's secp256k1) already
//!   prevents unauthorized destruction.
//!
//! Any other combination (e.g. 2 inputs → 1 output) is rejected.

#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(any(feature = "library", test))]
extern crate alloc;

mod error;

use ckb_std::{ckb_constants::Source, error::SysError, high_level::load_cell_data};

use error::Error;

// ─── Layout constants ──────────────────────────────────────────────────────────

const MANDATORY_LEN: usize = 92;
const SELLER_PUBKEY_LEN: usize = 33;
const STATUS_OFFSET: usize = 50;
const STATUS_TAKEN: u8 = 1;

// ─── Helpers ───────────────────────────────────────────────────────────────────

/// Count cells in the group by index until IndexOutOfBound.
fn count_group(source: Source) -> Result<usize, Error> {
    let mut i = 0usize;
    loop {
        match load_cell_data(i, source) {
            Ok(_) => i += 1,
            Err(SysError::IndexOutOfBound) => return Ok(i),
            Err(e) => return Err(e.into()),
        }
    }
}

// ─── Entry point ───────────────────────────────────────────────────────────────

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
    let n_in = count_group(Source::GroupInput)?;
    let n_out = count_group(Source::GroupOutput)?;

    // ── Destruction: no outputs ───────────────────────────────────────────────
    if n_out == 0 {
        for i in 0..n_in {
            let data = load_cell_data(i, Source::GroupInput)?;
            if data.len() < MANDATORY_LEN {
                return Err(Error::InputDataTooShort);
            }
            if data[STATUS_OFFSET] == STATUS_TAKEN {
                return Err(Error::CannotDestroyTakenCell);
            }
        }
        return Ok(());
    }

    // ── Creation: no inputs ───────────────────────────────────────────────────
    if n_in == 0 {
        for i in 0..n_out {
            let data = load_cell_data(i, Source::GroupOutput)?;
            if data.len() < MANDATORY_LEN {
                return Err(Error::OutputDataTooShort);
            }
        }
        return Ok(());
    }

    // ── Update: inputs and outputs must be 1:1 ────────────────────────────────
    if n_in != n_out {
        return Err(Error::InputOutputCountMismatch);
    }

    for i in 0..n_in {
        let input = load_cell_data(i, Source::GroupInput)?;
        let output = load_cell_data(i, Source::GroupOutput)?;

        if input.len() < MANDATORY_LEN {
            return Err(Error::InputDataTooShort);
        }
        if output.len() < MANDATORY_LEN {
            return Err(Error::OutputDataTooShort);
        }

        if input[STATUS_OFFSET] == STATUS_TAKEN {
            // Full freeze: every byte must be identical
            if input != output {
                return Err(Error::CellFrozenWhileTaken);
            }
        } else {
            // Available: only seller_pubkey[0..33) is immutable
            if input[..SELLER_PUBKEY_LEN] != output[..SELLER_PUBKEY_LEN] {
                return Err(Error::SellerPubkeyImmutable);
            }
        }
    }

    Ok(())
}
