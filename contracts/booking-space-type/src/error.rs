use ckb_std::error::SysError;

/// On-chain error codes returned by the BookingSpace type script.
#[repr(i8)]
#[derive(Debug, Clone, Copy)]
pub enum Error {
    // ── System errors forwarded from ckb-std ─────────────────────────────────
    IndexOutOfBound = 1,
    ItemMissing     = 2,
    LengthNotEnough = 3,
    Encoding        = 4,

    // ── Structure errors ──────────────────────────────────────────────────────
    /// Input cell data is shorter than MANDATORY_LEN (92 bytes)
    InputDataTooShort = 10,
    /// Output cell data is shorter than MANDATORY_LEN (92 bytes)
    OutputDataTooShort = 11,
    /// Number of group inputs does not equal number of group outputs during update
    InputOutputCountMismatch = 12,

    // ── Mutability rule violations ────────────────────────────────────────────
    /// Input cell status is 1 (taken) but output data differs — full freeze violated
    CellFrozenWhileTaken = 20,
    /// seller_pubkey[0..33) changed on an available cell — permanently immutable
    SellerPubkeyImmutable = 21,
    /// A taken cell was consumed without a corresponding output (destruction blocked)
    CannotDestroyTakenCell = 22,
}

impl From<SysError> for Error {
    fn from(e: SysError) -> Self {
        match e {
            SysError::IndexOutOfBound => Self::IndexOutOfBound,
            SysError::ItemMissing     => Self::ItemMissing,
            SysError::LengthNotEnough(_) => Self::LengthNotEnough,
            SysError::Encoding        => Self::Encoding,
            _                         => Self::Encoding,
        }
    }
}
