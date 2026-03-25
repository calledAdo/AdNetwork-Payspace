#!/usr/bin/env -S npx tsx
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "result-json": { type: "string" },
  },
});

if (!values["result-json"]) {
  process.stderr.write(JSON.stringify({
    error: "--result-json is required",
  }) + "\n");
  process.exit(1);
}

let parsed: unknown;
try {
  parsed = JSON.parse(values["result-json"]);
} catch (err) {
  process.stderr.write(JSON.stringify({
    error: "invalid --result-json",
    detail: err instanceof Error ? err.message : String(err),
  }) + "\n");
  process.exit(1);
}

const result = parsed && typeof parsed === "object" && !Array.isArray(parsed)
  ? (parsed as Record<string, unknown>)
  : null;

const fuel =
  result?.["fuel"] && typeof result["fuel"] === "object" && !Array.isArray(result["fuel"])
    ? (result["fuel"] as Record<string, unknown>)
    : null;

if (!fuel) {
  console.log(JSON.stringify({ ok: true, fuel: null }));
  process.exit(0);
}

if (fuel["sufficient"] !== true) {
  process.stderr.write(JSON.stringify({
    error: "insufficient_fuel",
    fuel,
    message:
      "MCP build response indicates the fee payer does not have enough spendable plain CKB fuel to safely continue.",
  }) + "\n");
  process.exit(2);
}

console.log(JSON.stringify({ ok: true, fuel }));
