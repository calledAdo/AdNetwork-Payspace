#!/usr/bin/env node
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";

function canonicalize(value) {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${canonicalize(val)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function signSnippetPayload(payload, privkey) {
  const hash = crypto
    .createHash("sha256")
    .update(canonicalize(payload))
    .digest();
  const raw = secp256k1.sign(hash, privkey, { prehash: false, format: "recovered" });
  return (
    "0x" +
    Buffer.concat([
      Buffer.from(raw.slice(1, 33)),
      Buffer.from(raw.slice(33, 65)),
      Buffer.from(raw.slice(0, 1)),
    ]).toString("hex")
  );
}

async function createServicesForTest(dataDir) {
  process.env.DATA_DIR = dataDir;
  process.env.TRACKING_URL = "http://localhost:4000";
  const suffix = `?t=${Date.now()}_${Math.random()}`;
  const bookingModule = await import(`../src/plugins/default/booking.ts${suffix}`);
  const snippetModule = await import(`../src/plugins/default/snippet.ts${suffix}`);
  const booking = bookingModule.createBookingService({
    readSnippetExists: (snippetId) => !!snippet.readSnippet(snippetId),
  });
  const snippet = snippetModule.createSnippetService({ booking });
  return { booking, snippet };
}

function encodedId(id) {
  return id.replace(/:/g, "__").replace(/\//g, "--");
}

async function run() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-backend-test-"));
  const { booking, snippet } = await createServicesForTest(dataDir);

  {
    const priv = secp256k1.utils.randomSecretKey();
    const ownerPubkey = `0x${Buffer.from(secp256k1.getPublicKey(priv, true)).toString("hex")}`;
    const created = snippet.createStandalone({
      owner_pubkey: ownerPubkey,
      signer_policy: "owner",
      dimensions: "300x250",
    });
    assert.equal(created.status, "inactive");
    const payload = {
      snippet_id: created.snippet_id,
      version: 1,
      image_url: "https://cdn.example/ad.png",
      destination_url: "https://example.com/landing",
      writeup: "hello ad",
    };
    const signature = signSnippetPayload(payload, priv);
    const updated = snippet.updateSignedContent(payload, signature);
    assert.equal(updated.snippet_id, created.snippet_id);
    assert.equal(updated.destination_url, payload.destination_url);
    assert.equal(updated.status, "inactive");
  }

  {
    const priv = secp256k1.utils.randomSecretKey();
    const sellerAgentPubkey = `0x${Buffer.from(secp256k1.getPublicKey(priv, true)).toString("hex")}`;
    const ownerPubkey = "0x" + "11".repeat(33);
    fs.mkdirSync(path.join(dataDir, "seller_profiles"), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "seller_profiles", `${encodedId(ownerPubkey)}.json`),
      JSON.stringify({ owner_pubkey: ownerPubkey, agent_pubkey: sellerAgentPubkey }),
    );
    const created = snippet.createStandalone({
      owner_pubkey: ownerPubkey,
      signer_policy: "seller_agent",
      dimensions: "300x250",
    });
    assert.equal(created.status, "inactive");
    const payload = {
      snippet_id: created.snippet_id,
      version: 1,
      image_url: "https://cdn.example/slot.png",
      destination_url: "https://example.com/slot",
      writeup: "slot ad",
    };
    const signature = signSnippetPayload(payload, priv);
    const updated = snippet.updateSignedContent(payload, signature);
    assert.equal(updated.destination_url, payload.destination_url);
    assert.equal(updated.status, "inactive");
    const withDimensions = snippet.updateSnippetMetadata(created.snippet_id, {
      dimensions: "320x50",
    });
    assert.equal(withDimensions.dimensions, "320x50");
  }

  {
    const created = snippet.createStandalone({
      signer_policy: "owner",
    });
    assert.equal(created.status, "inactive");
    const activated = snippet.activateOnImpression(created.snippet_id);
    assert.equal(activated?.status, "active");
  }

  {
    const registered = booking.registerBooking({
      image_url: "https://cdn.example/book.png",
      destination_url: "https://example.com/book",
    });
    assert.ok(registered.booking_id.startsWith("book_"));
    assert.ok(registered.tracked_image_url.includes("/tracking/image"));
    assert.ok(registered.tracked_click_url.includes("/tracking/click"));
    const context = booking.resolveContext({ booking_id: registered.booking_id });
    const reqStub = { headers: {}, ip: "127.0.0.1" };
    booking.recordTrackingEvent("impression", context, reqStub);
    booking.recordTrackingEvent("click", context, reqStub);
    const metrics = booking.getMetrics(registered.booking_id);
    assert.equal(metrics.impressions, 1);
    assert.equal(metrics.clicks, 1);
  }

  console.log("pluginization tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

