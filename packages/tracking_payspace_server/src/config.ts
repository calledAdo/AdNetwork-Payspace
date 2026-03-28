import dotenv from "dotenv";

dotenv.config({
  path: new URL("../../../.env", import.meta.url).pathname,
  override: false,
});

export const config = {
  // Runtime configuration — all values read from environment variables.
  port: Number(process.env.PORT ?? 4000),
  dataDir: process.env.DATA_DIR ?? "./packages/tracking_payspace_server/data",
  trackingUrl: process.env.TRACKING_URL ?? "http://localhost:4000",
} as const;
