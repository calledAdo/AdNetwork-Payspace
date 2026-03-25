#!/usr/bin/env -S npx tsx
import { parseArgs } from "node:util";

const MCP_URL = process.env["MCP_URL"] ?? "http://localhost:3000";

const { values } = parseArgs({
  options: {
    from: { type: "string" },
    to: { type: "string" },
    amount: { type: "string" },
    "udt-type-args": { type: "string" },
    "fee-payer": { type: "string" },
  },
});

if (!values.from || !values.to || !values.amount) {
  process.stderr.write(JSON.stringify({
    error: "--from, --to, and --amount are required",
  }) + "\n");
  process.exit(1);
}

const body: Record<string, unknown> = {
  from_lock_args: values.from,
  to_lock_args: values.to,
  udt_amount: values.amount,
};
if (values["udt-type-args"]) body["udt_type_args"] = values["udt-type-args"];
if (values["fee-payer"]) body["fee_payer_lock_args"] = values["fee-payer"];

const res = await fetch(`${MCP_URL}/transactions/build/xudt-transfer`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const data = await res.json();
if (!res.ok) {
  process.stderr.write(JSON.stringify(data) + "\n");
  process.exit(1);
}

const fuel =
  data && typeof data === "object" && !Array.isArray(data) &&
  data["fuel"] && typeof data["fuel"] === "object" && !Array.isArray(data["fuel"])
    ? data["fuel"]
    : null;
if (fuel && fuel["sufficient"] !== true) {
  process.stderr.write(JSON.stringify({ error: "insufficient_fuel", fuel }) + "\n");
  process.exit(2);
}

console.log(JSON.stringify(data));
