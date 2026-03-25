use ckb_std::error::SysError;
use core::convert::From;

/// On-chain error codes returned by the payment channel lockscript.
/// CKB interprets any non-zero i8 return as a script failure.
#[repr(i8)]
#[derive(Debug, Clone, Copy)]
pub enum Error {
    // ── System errors forwarded from ckb-std ─────────────────────────────────
    IndexOutOfBound = 1,
    ItemMissing     = 2,
    LengthNotEnough = 3,
    Encoding        = 4,

    // ── Argument / structure errors ───────────────────────────────────────────
    /// lock args must be exactly ARGS_LEN bytes
    InvalidArgsLength = 10,

    // ── Witness errors ────────────────────────────────────────────────────────
    /// Witness length doesn't match any known mode
    InvalidWitness = 20,
    /// lock field inside WitnessArgs is missing
    WitnessLockMissing = 21,
    /// Cooperative witness must carry exactly 2 × 65-byte secp256k1 signatures
    InvalidCoopSigLength = 22,
    /// Dispute witness length is wrong
    InvalidDisputeWitnessLength = 23,

    // ── Signature verification errors ─────────────────────────────────────────
    /// secp256k1 signature is structurally invalid
    InvalidSignature = 30,
    /// Signature does not match the expected blake160 pubkey hash
    SignatureMismatch = 31,
    /// Ticket signature does not match the buyer's key
    TicketSignatureMismatch = 32,

    // ── Cooperative-close errors ───────────────────────────────────────────────
    /// Channel is already in dispute; cooperative close is no longer allowed
    AlreadyInDispute = 40,
    /// Cooperative close: expected 2 UDT outputs
    InvalidCoopOutputCount = 41,
    /// UDT conservation violated: sum(inputs) ≠ sum(outputs)
    UdtConservationViolated = 42,
    /// Output amounts don't match the mutually agreed split
    CoopOutputMismatch = 43,

    // ── Dispute-initiation errors ──────────────────────────────────────────────
    /// Channel is already in dispute; cannot re-initiate
    DisputeAlreadyInitiated = 50,
    /// The new seller_claim must be strictly greater than the existing one
    TicketNotHigherThanCurrent = 51,
    /// Ticket timestamp must be strictly greater than the current one
    TicketTimestampNotNewer = 52,
    /// Output cell must preserve the UDT type during dispute initiation
    DisputeOutputTypeMismatch = 53,
    /// Output cell lock args don't reflect the new dispute state
    DisputeOutputArgsMismatch = 54,
    /// Output cell capacity must equal input cell capacity
    DisputeCapacityMismatch = 55,

    // ── Post-dispute payout errors ─────────────────────────────────────────────
    /// Dispute window has not expired yet
    DisputeWindowNotExpired = 60,
    /// Payout output count is wrong
    InvalidPayoutOutputCount = 61,
    /// Payout UDT amounts don't match the settled dispute claim
    PayoutAmountMismatch = 62,
}

impl From<SysError> for Error {
    fn from(e: SysError) -> Self {
        match e {
            SysError::IndexOutOfBound => Self::IndexOutOfBound,
            SysError::ItemMissing => Self::ItemMissing,
            SysError::LengthNotEnough(_) => Self::LengthNotEnough,
            SysError::Encoding => Self::Encoding,
            _ => Self::Encoding,
        }
    }
}
