#!/usr/bin/env node

const BASE_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:4000";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const ownerPubkey = `0xmock_owner_${Date.now().toString(16)}`;
  const body = {
    owner_pubkey: ownerPubkey,
    name: "Mock Seller",
    site_url: "https://publisher.example.test",
    contact_email: "publisher@example.test",
    price_floor: "500",
    keyword_flags: "1",
    ad_slots: [
      {
        element_id: "hero-banner-top",
        dimensions: "728x90",
        ad_position: 0,
        publication_mode: 1,
      },
    ],
  };

  console.log(`[test] POST ${BASE_URL}/publishers`);
  const createRes = await fetch(`${BASE_URL}/publishers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const createText = await createRes.text();
  console.log(`[test] create status: ${createRes.status}`);
  console.log(createText);

  if (!createRes.ok) {
    process.exit(1);
  }

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    await sleep(1000);
    const res = await fetch(`${BASE_URL}/publishers/${encodeURIComponent(ownerPubkey)}`);
    const data = await res.json();
    console.log(`[test] poll ${attempt}:`, JSON.stringify(data, null, 2));
    if (data.agent_status === "active" || data.agent_status === "error") {
      break;
    }
  }
}

main().catch((err) => {
  console.error("[test] fatal:", err);
  process.exit(1);
});
