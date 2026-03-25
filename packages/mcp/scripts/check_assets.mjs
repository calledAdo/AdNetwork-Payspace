#!/usr/bin/env node
// Query all live cells for our testnet wallet via the local MCP.
// Shows CKB balance and any UDT/type-script cells.
//
// Usage:  node scripts/check_assets.mjs

const MCP_URL     = process.env.MCP_URL      ?? "http://localhost:3000";
const LOCK_ARGS   = process.env.CKB_LOCK_ARGS ?? "0x6fef11b3c4b63b14f0b9b5408bcb15e4ad8989e0";
const SECP256K1   = "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8";

const url = `${MCP_URL}/cells/by-lock?code_hash=${SECP256K1}&hash_type=type&args=${LOCK_ARGS}&limit=500`;

console.log(`\nQuerying MCP: ${url}\n`);

const res  = await fetch(url);
const data = await res.json();

if (!res.ok) {
  console.error("Error:", data);
  process.exit(1);
}

const cells = data.cells ?? [];
console.log(`Lock hash  : ${data.script_hash}`);
console.log(`Lock args  : ${LOCK_ARGS}`);
console.log(`Live cells : ${data.total}\n`);

if (cells.length === 0) {
  console.log("No cells found. Have you funded this address yet?");
  console.log("Get testnet CKB at: https://faucet.nervos.org/\n");
  process.exit(0);
}

// ── Summarise ─────────────────────────────────────────────────────────────────

let totalCkbShannons = 0n;
const udtCells   = [];
const plainCells = [];

for (const cell of cells) {
  const cap = BigInt(cell.output.capacity);
  totalCkbShannons += cap;

  if (cell.output.type) {
    udtCells.push(cell);
  } else {
    plainCells.push(cell);
  }
}

const ckb = Number(totalCkbShannons) / 1e8;

console.log(`=== Assets ===\n`);
console.log(`CKB balance  : ${ckb.toLocaleString()} CKB  (${totalCkbShannons} shannons)`);
console.log(`Plain cells  : ${plainCells.length}`);
console.log(`Type cells   : ${udtCells.length}`);

if (udtCells.length > 0) {
  console.log("\n--- Type-script cells (UDT / contract data) ---");
  for (const cell of udtCells) {
    const cap  = (Number(BigInt(cell.output.capacity)) / 1e8).toFixed(2);
    const type = cell.output.type;
    const data = cell.output_data ?? "0x";
    console.log(`  outpoint  : ${cell.out_point.tx_hash}:${cell.out_point.index}`);
    console.log(`  capacity  : ${cap} CKB`);
    console.log(`  type.code_hash : ${type.code_hash}`);
    console.log(`  type.hash_type : ${type.hash_type}`);
    console.log(`  type.args      : ${type.args}`);
    console.log(`  data           : ${data.length > 66 ? data.slice(0, 66) + "…" : data}`);
    console.log();
  }
}

console.log("\n--- All cells (outpoint / capacity) ---");
for (const cell of cells) {
  const cap = (Number(BigInt(cell.output.capacity)) / 1e8).toFixed(2);
  const tag = cell.output.type ? "[type]" : "[plain]";
  console.log(`  ${tag}  ${cell.out_point.tx_hash}:${cell.out_point.index}  ${cap} CKB`);
}
console.log();
