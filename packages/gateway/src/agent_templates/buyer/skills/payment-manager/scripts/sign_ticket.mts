#!/usr/bin/env -S npx tsx
// Sign an off-chain payment ticket using the buyer's local keyfile.
// Delegates to the shared sign_ticket.mts in scripts/.
//
// Usage:  npx tsx sign_ticket.mts \
//           --seller-claim <decimal_u128> \
//           --timestamp    <decimal_u64> \
//           --channel-id   <0x...32bytes>
// Output: JSON with { signature, seller_claim_udt, ticket_timestamp, channel_id }
//
// Environment:
//   AGENT_DIR  path to agent directory containing keyfile (required)
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
const __dir = dirname(fileURLToPath(import.meta.url));
const target = resolve(__dir, "../../../scripts/sign_ticket.mts");
const result = spawnSync("npx", ["tsx", target, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
});
process.exit(result.status ?? 1);
//# sourceMappingURL=sign_ticket.mjs.map