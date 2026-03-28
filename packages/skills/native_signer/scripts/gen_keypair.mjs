#!/usr/bin/env node
// Generate a secp256k1 keypair and persist key material to an output directory.
//
// Usage:  node gen_keypair.mjs --dir /path/to/agent/dir
// Output: JSON with { pubkey, blake160 }
import { ccc } from "@ckb-ccc/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { dir: { type: "string" } },
});

if (!values.dir) {
  process.stderr.write(JSON.stringify({ error: "--dir is required" }) + "\n");
  process.exit(1);
}

mkdirSync(values.dir, { recursive: true });

const privkeyBytes = randomBytes(32);
const privkeyHex = privkeyBytes.toString("hex");
const pubkeyBytes = secp256k1.getPublicKey(privkeyBytes, true);
const pubkeyHex = Buffer.from(pubkeyBytes).toString("hex");

const hashHex = new ccc.HasherCkb().update(pubkeyBytes).digest();
const blake160 = "0x" + hashHex.slice(2, 42);

writeFileSync(
  `${values.dir}/keyfile`,
  JSON.stringify({ privkey: privkeyHex }),
  { mode: 0o600 },
);
writeFileSync(
  `${values.dir}/pubkey`,
  JSON.stringify({ pubkey: "0x" + pubkeyHex, blake160 }),
  { mode: 0o644 },
);

console.log(JSON.stringify({ pubkey: "0x" + pubkeyHex, blake160 }));
