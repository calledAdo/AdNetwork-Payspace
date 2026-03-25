#!/usr/bin/env -S npx tsx
// Verify that a seller agent card's pubkey matches the on-chain cell pubkey.
// Pure local computation — no HTTP call.
//
// Usage:  npx tsx verify_pubkey_match.mts --card-pubkey <0x...> --cell-pubkey <0x...>
// Output: JSON { match: true } on success; exit 1 with { match: false, card, cell } on mismatch.
import { parseArgs } from "node:util";
const { values } = parseArgs({
    options: {
        "card-pubkey": { type: "string" },
        "cell-pubkey": { type: "string" },
    },
});
if (!values["card-pubkey"] || !values["cell-pubkey"]) {
    process.stderr.write(JSON.stringify({ error: "--card-pubkey and --cell-pubkey are required" }) + "\n");
    process.exit(1);
}
/**
 * Normalizes hex strings so the comparison ignores case and the optional `0x`
 * prefix.
 */
function normalizeHex(value: string) {
    return value.toLowerCase().replace(/^0x/, "");
}
const card = normalizeHex(values["card-pubkey"]);
const cell = normalizeHex(values["cell-pubkey"]);
if (card === cell) {
    console.log(JSON.stringify({ match: true }));
}
else {
    console.log(JSON.stringify({ match: false, card, cell }));
    process.exit(1);
}
//# sourceMappingURL=verify_pubkey_match.mjs.map
