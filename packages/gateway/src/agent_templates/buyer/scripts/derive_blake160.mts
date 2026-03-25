#!/usr/bin/env -S npx tsx
// Derive the blake160 (20-byte lock arg) from a compressed secp256k1 pubkey.
// Pure local computation — no HTTP call.
//
// Usage:  npx tsx derive_blake160.mts --pubkey <0x...33bytes>
// Output: JSON with { blake160 }
import { ccc } from "@ckb-ccc/core";
import { parseArgs } from "node:util";
const { values } = parseArgs({
    options: { pubkey: { type: "string" } },
});
if (!values.pubkey) {
    process.stderr.write(JSON.stringify({ error: "--pubkey is required" }) + "\n");
    process.exit(1);
}
const pubkeyBytes = Buffer.from(values.pubkey.replace(/^0x/, ""), "hex");
if (pubkeyBytes.length !== 33) {
    process.stderr.write(JSON.stringify({
        error: "pubkey must be 33 bytes (compressed secp256k1)",
    }) + "\n");
    process.exit(1);
}
const hashHex = new ccc.HasherCkb().update(pubkeyBytes).digest();
const blake160 = "0x" + hashHex.slice(2, 42);
console.log(JSON.stringify({ blake160 }));
//# sourceMappingURL=derive_blake160.mjs.map