#!/usr/bin/env node
// Deploy BookingSpace type script and PaymentChannel lock script to CKB testnet.
// Each contract binary is stored as cell data in a dedicated "code cell".
// The cells are owned by our testnet wallet (secp256k1 lock).
//
// After deployment, tx_hash + index for each contract is saved to:
//   packages/mcp/scripts/deployed_contracts.json
//
// Usage:  node scripts/deploy_contracts.mjs

import { secp256k1 } from "@noble/curves/secp256k1.js";
import blake2b    from "blake2b";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const PRIVATE_KEY  = process.env.CKB_PRIVATE_KEY  ?? "d9d8ed1b72994ee895eb148e303771a77a60df9624cf00a4345dbc41bb6b6c80";
const LOCK_ARGS    = process.env.CKB_LOCK_ARGS    ?? "0x6fef11b3c4b63b14f0b9b5408bcb15e4ad8989e0";
const RPC_URL      = process.env.CKB_RPC_URL      ?? "https://testnet.ckb.dev/rpc";
const INDEXER_URL  = process.env.CKB_INDEXER_URL  ?? "https://testnet.ckb.dev/indexer";

const SECP256K1_CODE_HASH = "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8";
const SECP256K1_DEP_TX    = "0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37";
const ESTIMATED_FEE       = 5_000_000n; // 0.05 CKB

const CONTRACTS_DIR = resolve(__dir, "../../../contracts/target/riscv64imac-unknown-none-elf/release");

const CONTRACTS = [
  { name: "booking_space_type",  file: resolve(CONTRACTS_DIR, "booking-space-type") },
  { name: "payment_channel_lock", file: resolve(CONTRACTS_DIR, "payment-channel-lock") },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function ckbHash(buf) {
  const personal = Buffer.alloc(16);
  personal.write("ckb-default-hash");
  const h = blake2b(32, null, null, personal);
  h.update(buf);
  return Buffer.from(h.digest());
}

function u32LE(n)  { const b = Buffer.alloc(4);  b.writeUInt32LE(n);  return b; }
function u64LE(n)  { const b = Buffer.alloc(8);  b.writeBigUInt64LE(BigInt(n)); return b; }
function hex(buf)  { return "0x" + Buffer.from(buf).toString("hex"); }
function unhex(s)  { return Buffer.from(s.replace(/^0x/,""), "hex"); }
function hexU64(s) { return BigInt(s); }
function hexU32(s) { return Number(BigInt(s)); }

// ── RPC ───────────────────────────────────────────────────────────────────────

let _id = 1;
async function rpc(url, method, params) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: _id++, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`RPC ${method}: ${j.error.message}`);
  return j.result;
}

async function getLiveCells(lockArgs) {
  const script = { code_hash: SECP256K1_CODE_HASH, hash_type: "type", args: lockArgs };
  return rpc(INDEXER_URL, "get_cells", [{ script, script_type: "lock" }, "asc", "0xc8"]);
}

async function sendTx(tx) {
  return rpc(RPC_URL, "send_transaction", [tx, "passthrough"]);
}

// ── Transaction building ──────────────────────────────────────────────────────

// Molecule-serialize a Script (code_hash + hash_type + args)
function serializeScript(s) {
  const codeHash = unhex(s.code_hash); // 32 bytes
  const hashType = s.hash_type === "type" ? 0x01 : s.hash_type === "data1" ? 0x02 : 0x00;
  const args     = unhex(s.args);
  // Script table: 4(total) + 4(code_hash_offset) + 4(hash_type_offset) + 4(args_offset)
  //              + 32(code_hash) + 1(hash_type) + N(args)
  const total = 4 + 4 + 4 + 4 + 32 + 1 + args.length;
  const b = Buffer.alloc(total);
  let off = 0;
  b.writeUInt32LE(total, off); off += 4;
  b.writeUInt32LE(16,    off); off += 4; // code_hash starts at 16
  b.writeUInt32LE(48,    off); off += 4; // hash_type starts at 48
  b.writeUInt32LE(49,    off); off += 4; // args starts at 49
  codeHash.copy(b, off); off += 32;
  b[off++] = hashType;
  args.copy(b, off);
  return b;
}

// Serialize raw transaction (without witnesses) for hash
function serializeRawTx(tx) {
  // version(4) + cell_deps + header_deps + inputs + outputs + outputs_data
  const version = u32LE(0);

  // cell_deps: each is 36(out_point) + 1(dep_type) = 37 bytes
  const cellDeps = tx.cell_deps.map(cd => {
    const b = Buffer.alloc(37);
    unhex(cd.out_point.tx_hash).copy(b, 0);
    b.writeUInt32LE(hexU32(cd.out_point.index), 32);
    b[36] = cd.dep_type === "dep_group" ? 1 : 0;
    return b;
  });
  const cellDepsVec = serializeVec(cellDeps, false);

  // header_deps: empty
  const headerDepsVec = Buffer.from([0,0,0,0]); // length=0

  // inputs: each is 8(since) + 36(outpoint) = 44 bytes
  const inputs = tx.inputs.map(inp => {
    const b = Buffer.alloc(44);
    b.writeBigUInt64LE(BigInt(inp.since), 0);
    unhex(inp.previous_output.tx_hash).copy(b, 8);
    b.writeUInt32LE(hexU32(inp.previous_output.index), 40);
    return b;
  });
  const inputsVec = serializeVec(inputs, false);

  // outputs: each is a CellOutput (capacity + lock + optional type)
  const outputs = tx.outputs.map(out => {
    const lockBuf = serializeScript(out.lock);
    const typeBuf = out.type ? serializeScript(out.type) : null;
    // CellOutput: 4(total) + 4(cap_off) + 4(lock_off) + 4(type_off) + 8(cap) + lock + (type?)
    const total = 4 + 4 + 4 + 4 + 8 + lockBuf.length + (typeBuf ? typeBuf.length : 0);
    const b = Buffer.alloc(total);
    b.writeUInt32LE(total, 0);
    b.writeUInt32LE(16, 4);               // capacity at offset 16
    b.writeUInt32LE(24, 8);               // lock at 24
    b.writeUInt32LE(24 + lockBuf.length, 12); // type after lock (or same if empty)
    b.writeBigUInt64LE(hexU64(out.capacity), 16);
    lockBuf.copy(b, 24);
    if (typeBuf) typeBuf.copy(b, 24 + lockBuf.length);
    return b;
  });
  const outputsVec = serializeFixedVec(outputs);

  // outputs_data: each is a byte array
  const outputsData = tx.outputs_data.map(d => {
    const bytes = unhex(d);
    return Buffer.concat([u32LE(bytes.length), bytes]);
  });
  const outputsDataVec = serializeVec(outputsData, true);

  return Buffer.concat([version, cellDepsVec, headerDepsVec, inputsVec, outputsVec, outputsDataVec]);
}

// Dynamic-size vector: 4(count) + 4*count(offsets) + items
function serializeVec(items, withOffsets) {
  if (!withOffsets) {
    // fixed-item vector (all same size): 4(count) + items
    const count = Buffer.alloc(4); count.writeUInt32LE(items.length);
    return Buffer.concat([count, ...items]);
  }
  // dynamic vector: 4(total) + 4*N(offsets) + items
  const headerSize = 4 + 4 * items.length;
  let offset = headerSize;
  const offsets = items.map(item => { const o = offset; offset += item.length; return o; });
  const total = u32LE(offset);
  const offsetBufs = offsets.map(o => u32LE(o));
  return Buffer.concat([total, ...offsetBufs, ...items]);
}

function serializeFixedVec(items) {
  // For outputs (CellOutput is dynamic): use dynamic vec
  const headerSize = 4 + 4 * items.length;
  let offset = headerSize;
  const offsets = items.map(item => { const o = offset; offset += item.length; return o; });
  const total = u32LE(offset);
  const offsetBufs = offsets.map(o => u32LE(o));
  return Buffer.concat([total, ...offsetBufs, ...items]);
}

// Compute the signing message for the first witness group
function computeSigningMessage(txHash, witnesses) {
  const personal = Buffer.alloc(16);
  personal.write("ckb-default-hash");
  const h = blake2b(32, null, null, personal);
  h.update(unhex(txHash));
  for (const w of witnesses) {
    const wBuf = unhex(w);
    h.update(u64LE(wBuf.length));
    h.update(wBuf);
  }
  return hex(Buffer.from(h.digest()));
}

// Build a 65-byte placeholder witness (WitnessArgs with 65-byte zero lock)
function placeholderWitness() {
  const b = Buffer.alloc(85);
  b.writeUInt32LE(85, 0);  // total
  b.writeUInt32LE(16, 4);  // offset_lock
  b.writeUInt32LE(85, 8);  // offset_input_type
  b.writeUInt32LE(85, 12); // offset_output_type
  b.writeUInt32LE(65, 16); // lock field length
  return b;
}

function injectSig(tx, sigHex) {
  const sig = unhex(sigHex);
  const w   = placeholderWitness();
  sig.copy(w, 20);
  return { ...tx, witnesses: [hex(w), ...tx.witnesses.slice(1)] };
}

function sign(msgHex, privKeyHex) {
  const msg  = unhex(msgHex);
  const priv = unhex(privKeyHex);
  // format:'recovered' → [v(1), r(32), s(32)]; CKB wants r(32)||s(32)||v(1)
  const raw  = secp256k1.sign(msg, priv, { format: "recovered" });
  const ckb  = Buffer.concat([raw.slice(1, 65), raw.slice(0, 1)]);
  return "0x" + ckb.toString("hex");
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log("\n=== CKB Contract Deployment ===\n");
console.log(`Wallet     : ${LOCK_ARGS}`);
console.log(`RPC        : ${RPC_URL}\n`);

// 1. Read contract binaries
const contractData = CONTRACTS.map(c => {
  const bytes = readFileSync(c.file);
  console.log(`${c.name}: ${bytes.length.toLocaleString()} bytes (${(bytes.length/1024).toFixed(1)} KB)`);
  return { ...c, bytes, hex: hex(bytes) };
});

// 2. Capacity needed per contract cell:
//    capacity(8) + lock(secp256k1 = 53) + data(N) bytes → * 1 CKB/byte
const secp256k1Lock = { code_hash: SECP256K1_CODE_HASH, hash_type: "type", args: LOCK_ARGS };
const outputs = contractData.map(c => {
  const cellBytes = 8n + 53n + BigInt(c.bytes.length);  // cap + lock + data
  const capacity  = cellBytes * 100_000_000n;           // shannons per byte
  return {
    capacity: "0x" + capacity.toString(16),
    lock:     secp256k1Lock,
    type:     null,
  };
});
const outputsData = contractData.map(c => c.hex);

const totalNeeded = outputs.reduce((s, o) => s + hexU64(o.capacity), 0n) + ESTIMATED_FEE;
console.log(`\nTotal capacity needed: ${(Number(totalNeeded) / 1e8).toFixed(2)} CKB`);

// 3. Collect input cells
console.log("\nFetching live cells from indexer...");
const cellsResult = await getLiveCells(LOCK_ARGS);
const available   = cellsResult.objects ?? [];
console.log(`Found ${available.length} live cells`);

if (available.length === 0) {
  console.error("\nNo cells found — fund your address first:");
  console.error("  Address: ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqt0augm839k8v20pwd4gz9uk90y4kycncqvun00u");
  console.error("  Faucet:  https://faucet.nervos.org/");
  process.exit(1);
}

const inputs = [];
let inputCapacity = 0n;
for (const cell of available) {
  if (cell.output.type) continue; // skip type-script cells
  inputs.push({ since: "0x0", previous_output: cell.out_point });
  inputCapacity += hexU64(cell.output.capacity);
  if (inputCapacity >= totalNeeded) break;
}

if (inputCapacity < totalNeeded) {
  console.error(`\nInsufficient funds: need ${(Number(totalNeeded)/1e8).toFixed(2)} CKB, have ${(Number(inputCapacity)/1e8).toFixed(2)} CKB`);
  process.exit(1);
}

// 4. Change cell (return leftover to self)
const change = inputCapacity - totalNeeded + ESTIMATED_FEE;
if (change > 0n) {
  outputs.push({
    capacity: "0x" + change.toString(16),
    lock:     secp256k1Lock,
    type:     null,
  });
  outputsData.push("0x");
}

// 5. Build unsigned tx
const tx = {
  version:      "0x0",
  cell_deps:    [{ out_point: { tx_hash: SECP256K1_DEP_TX, index: "0x0" }, dep_type: "dep_group" }],
  header_deps:  [],
  inputs,
  outputs,
  outputs_data: outputsData,
  witnesses:    [hex(placeholderWitness())],
};

// 6. Sign
const rawHash = hex(ckbHash(serializeRawTx(tx)));
const signingMsg = computeSigningMessage(rawHash, tx.witnesses);
const sig = sign(signingMsg, PRIVATE_KEY);
const signedTx = injectSig(tx, sig);

console.log(`\nTransaction hash: ${rawHash}`);
console.log(`Inputs:  ${inputs.length}  (${(Number(inputCapacity)/1e8).toFixed(2)} CKB)`);
console.log(`Outputs: ${outputs.length}  (${contractData.length} contract cells + ${outputs.length - contractData.length} change)`);

// 7. Broadcast
console.log("\nBroadcasting transaction...");
let txHash;
try {
  txHash = await sendTx(signedTx);
  console.log(`✓ Submitted! tx_hash: ${txHash}`);
} catch (err) {
  console.error("\n✗ Submission failed:", err.message);
  process.exit(1);
}

// 8. Save deployment record
const deployed = {};
for (let i = 0; i < contractData.length; i++) {
  const c = contractData[i];
  const codeHash = hex(ckbHash(c.bytes));
  deployed[c.name] = {
    tx_hash:   txHash,
    index:     i,
    code_hash: codeHash,
    hash_type: "data1",
    size_bytes: c.bytes.length,
  };
  console.log(`\n${c.name}:`);
  console.log(`  out_point : ${txHash}:${i}`);
  console.log(`  code_hash : ${codeHash}  (data1)`);
}

const outPath = resolve(__dir, "deployed_contracts.json");
writeFileSync(outPath, JSON.stringify(deployed, null, 2));
console.log(`\nDeployment record saved to: ${outPath}\n`);
