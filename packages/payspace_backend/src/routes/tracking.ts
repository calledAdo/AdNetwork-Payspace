// Tracking routes — impression pixel, click redirect, stats, signed snippet
// content updates, and snippet serving.
//
// Lean model:
// - `snippet_id` is the seller-side lifetime slot metric id
// - `booking_id` is the buyer-side campaign metric id
// - `metrics` stores one shared shape keyed by metric id
// - `slot_details` stores stable seller-side slot metadata written by the
//   publisher slot flow (`POST /publishers/:ownerPubkey/slots`)
// - `snippet_content` stores mutable render state only

import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { secp256k1 } from "../../../gateway/node_modules/@noble/curves/secp256k1.js";
import { config } from "../config.js";
import { readRecord, writeRecord, updateRecord } from "../store.js";
import type { SellerSlotDetails } from "./publishers.js";
import { readAgentBinding, sendOwnerCommand } from "../orchestration.js";

const router = Router();

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

type TrackingEventType = "impression" | "click";
type SnippetStatus = "inactive" | "active";

interface MetricsRecord {
  schema_version: 1;
  metric_id: string;
  impressions: number;
  clicks: number;
  geo_impressions: Record<string, number>;
  geo_clicks: Record<string, number>;
}

interface BookingTrackingRegistration {
  schema_version: 1;
  booking_id: string;
  image_url: string;
  destination_url: string;
  tracked_image_url: string;
  tracked_click_url: string;
  created_at: string;
}

interface SnippetContentRecord {
  schema_version: 1;
  snippet_id: string;
  version: number;
  status: SnippetStatus;
  image_url: string | null;
  action_url: string | null;
  write_up: string | null;
  updated_at: string;
}

interface TrackingContext {
  snippet_id: string | null;
  booking_id: string | null;
  destination_url: string | null;
}

interface SnippetContentPayload {
  snippet_id: string;
  version: number;
  status: SnippetStatus;
  image_url: string | null;
  action_url: string | null;
  write_up: string | null;
}

interface SellerProfileLookup {
  agent_pubkey: string | null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function buildTrackingUrl(
  pathname: string,
  params: Record<string, string | null>,
): string {
  const url = new URL(pathname, config.trackingUrl);
  for (const [key, value] of Object.entries(params)) {
    if (!value) continue;
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function buildSnippetImpressionTrackingUrl(snippetId: string): string {
  return buildTrackingUrl("/tracking/image", { snippet_id: snippetId });
}

function buildSnippetSeenUrl(snippetId: string): string {
  return buildTrackingUrl("/tracking/snippet-seen", { snippet_id: snippetId });
}

function buildSnippetClickTrackingUrl(snippetId: string): string {
  return buildTrackingUrl("/tracking/click", {
    snippet_id: snippetId,
    ping: "1",
  });
}

function buildBookingImpressionTrackingUrl(bookingId: string): string {
  return buildTrackingUrl("/tracking/image", { booking_id: bookingId });
}

function buildBookingClickTrackingUrl(bookingId: string): string {
  return buildTrackingUrl("/tracking/click", { booking_id: bookingId });
}

function buildTrackedImageUrl(bookingId: string): string {
  return buildTrackingUrl("/tracking/image", { booking_id: bookingId });
}

function buildEmbedHtml(snippetId: string): string {
  const loaderUrl = buildTrackingUrl("/tracking/snippet/loader.js", {
    id: snippetId,
  });
  return [
    `<div id="${snippetId}"></div>`,
    `<script async src="${loaderUrl}" crossorigin="anonymous"></script>`,
  ].join("\n");
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${canonicalize(val)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashSnippetContentPayload(payload: SnippetContentPayload): string {
  return crypto
    .createHash("sha256")
    .update(canonicalize(payload))
    .digest("hex");
}

function verifySnippetContentSignature(
  contentHashHex: string,
  signatureHex: string,
  agentPubkeyHex: string,
): boolean {
  const messageBytes = Buffer.from(contentHashHex.replace(/^0x/, ""), "hex");
  const signatureBytes = Buffer.from(signatureHex.replace(/^0x/, ""), "hex");
  const pubkeyBytes = Buffer.from(agentPubkeyHex.replace(/^0x/, ""), "hex");

  if (messageBytes.length !== 32) return false;
  if (signatureBytes.length !== 65) return false;
  if (pubkeyBytes.length !== 33) return false;

  try {
    return secp256k1.verify(
      signatureBytes.subarray(0, 64),
      messageBytes,
      pubkeyBytes,
      {
        prehash: false,
      },
    );
  } catch {
    return false;
  }
}

function parseDimensions(value: string | null): {
  widthPx: number | null;
  heightPx: number | null;
} {
  if (!value) return { widthPx: null, heightPx: null };
  const match = value.trim().match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return { widthPx: null, heightPx: null };
  return { widthPx: Number(match[1]), heightPx: Number(match[2]) };
}

function resolveCountry(req: Request): string {
  const header = req.headers["x-country"];
  if (typeof header === "string" && header.length === 2)
    return header.toUpperCase();

  const xff = req.headers["x-forwarded-for"];
  const ip = (
    typeof xff === "string" ? xff.split(",")[0] : (req.ip ?? "")
  )?.trim();
  if (ip && ip !== "::1" && ip !== "127.0.0.1") return `IP:${ip}`;

  return "unknown";
}

function readMetrics(metricId: string): MetricsRecord | null {
  const raw = readRecord<unknown>("metrics", metricId);
  if (!raw || typeof raw !== "object") return null;
  const typed = raw as Record<string, unknown>;
  return {
    schema_version: 1,
    metric_id:
      typeof typed["metric_id"] === "string" ? typed["metric_id"] : metricId,
    impressions: Number(typed["impressions"] ?? 0),
    clicks: Number(typed["clicks"] ?? 0),
    geo_impressions:
      typed["geo_impressions"] &&
      typeof typed["geo_impressions"] === "object" &&
      !Array.isArray(typed["geo_impressions"])
        ? (typed["geo_impressions"] as Record<string, number>)
        : {},
    geo_clicks:
      typed["geo_clicks"] &&
      typeof typed["geo_clicks"] === "object" &&
      !Array.isArray(typed["geo_clicks"])
        ? (typed["geo_clicks"] as Record<string, number>)
        : {},
  };
}

function bumpMetrics(
  metricId: string,
  type: TrackingEventType,
  country: string,
): void {
  updateRecord<MetricsRecord>("metrics", metricId, (currentRaw) => {
    const current =
      (currentRaw as MetricsRecord | null) ??
      ({
        schema_version: 1,
        metric_id: metricId,
        impressions: 0,
        clicks: 0,
        geo_impressions: {},
        geo_clicks: {},
      } satisfies MetricsRecord);

    return {
      ...current,
      metric_id: metricId,
      impressions: current.impressions + (type === "impression" ? 1 : 0),
      clicks: current.clicks + (type === "click" ? 1 : 0),
      geo_impressions:
        type === "impression"
          ? {
              ...current.geo_impressions,
              [country]: (current.geo_impressions[country] ?? 0) + 1,
            }
          : current.geo_impressions,
      geo_clicks:
        type === "click"
          ? {
              ...current.geo_clicks,
              [country]: (current.geo_clicks[country] ?? 0) + 1,
            }
          : current.geo_clicks,
    };
  });
}

function readSlotDetails(snippetId: string): SellerSlotDetails | null {
  const slot = readRecord<SellerSlotDetails>("slot_details", snippetId);
  if (!slot) return null;
  return {
    ...slot,
    installation: slot.installation ?? { status: "awaiting_install" },
  };
}

function readSnippetContent(snippetId: string): SnippetContentRecord {
  return (
    readRecord<SnippetContentRecord>("snippet_content", snippetId) ?? {
      schema_version: 1,
      snippet_id: snippetId,
      version: 0,
      status: "inactive",
      image_url: null,
      action_url: null,
      write_up: null,
      updated_at: "",
    }
  );
}

function resolveTrackingContext(
  input: Record<string, unknown>,
): TrackingContext {
  const context: TrackingContext = {
    snippet_id: asString(input["snippet_id"]),
    booking_id: asString(input["booking_id"]),
    destination_url: asString(input["url"]),
  };

  const legacyId = asString(input["id"]);

  if (legacyId) {
    const booking = readRecord<BookingTrackingRegistration>(
      "bookings",
      legacyId,
    );
    if (booking) {
      context.booking_id ??= booking.booking_id;
      context.destination_url ??= booking.destination_url;
    }

    const slotDetails = readSlotDetails(legacyId);
    if (slotDetails) {
      context.snippet_id ??= slotDetails.snippet_id;
    }
  }

  if (context.booking_id) {
    const booking = readRecord<BookingTrackingRegistration>(
      "bookings",
      context.booking_id,
    );
    if (booking) {
      context.destination_url ??= booking.destination_url;
    }
  }

  return context;
}

function recordTrackingEvent(
  type: TrackingEventType,
  context: TrackingContext,
  req: Request,
): void {
  const country = resolveCountry(req);

  if (context.snippet_id) bumpMetrics(context.snippet_id, type, country);
  if (context.booking_id) bumpMetrics(context.booking_id, type, country);
}

function lookupSlotSignerPubkey(slotDetails: SellerSlotDetails): string {
  const seller = readRecord<SellerProfileLookup>(
    "seller_profiles",
    slotDetails.owner_pubkey,
  );
  const agentPubkey = seller?.agent_pubkey ?? null;
  if (!agentPubkey) {
    throw new Error("publisher does not have an active seller agent pubkey");
  }
  return agentPubkey;
}

function upsertSlotDetailsRecord(input: {
  snippet_id: string;
  owner_pubkey: string;
  page_url: string | null;
  dimensions: string | null;
  min_amount_per_1000: string;
  ad_position: number;
  publication_mode: number;
  keyword_flags: string;
  policy_text: string | null;
  metadata: Record<string, unknown> | null;
}): SellerSlotDetails {
  return updateRecord<SellerSlotDetails>(
    "slot_details",
    input.snippet_id,
    (current) => ({
      schema_version: 1,
      snippet_id: input.snippet_id,
      owner_pubkey: input.owner_pubkey || current?.owner_pubkey || "",
      page_url: input.page_url ?? current?.page_url ?? null,
      dimensions: input.dimensions ?? current?.dimensions ?? null,
      min_amount_per_1000:
        input.min_amount_per_1000 || current?.min_amount_per_1000 || "0",
      ad_position: Number.isInteger(input.ad_position)
        ? input.ad_position
        : (current?.ad_position ?? 0),
      publication_mode: Number.isInteger(input.publication_mode)
        ? input.publication_mode
        : (current?.publication_mode ?? 1),
      keyword_flags: input.keyword_flags || current?.keyword_flags || "0",
      policy_text: input.policy_text ?? current?.policy_text ?? null,
      metadata: input.metadata ?? current?.metadata ?? null,
      installation: current?.installation ?? { status: "awaiting_install" },
      created_at: current?.created_at ?? nowIso(),
    }),
  );
}

async function markSnippetSeen(snippetId: string): Promise<{
  slotDetails: SellerSlotDetails;
  publishCommandSent: boolean;
}> {
  const slotDetails = readSlotDetails(snippetId);
  if (!slotDetails) {
    throw new Error("slot details not found");
  }

  if (slotDetails.installation.status === "disabled") {
    return { slotDetails, publishCommandSent: false };
  }

  if (slotDetails.installation.status === "publishing") {
    return { slotDetails, publishCommandSent: false };
  }

  const binding = readAgentBinding("seller_profile", slotDetails.owner_pubkey);
  if (!binding || binding.status !== "active") {
    throw new Error("active seller agent binding not found");
  }

  await sendOwnerCommand(binding, "publish_slot", {
    snippet_id: slotDetails.snippet_id,
  });

  const updated = updateRecord<SellerSlotDetails>(
    "slot_details",
    slotDetails.snippet_id,
    (current) => {
      const base = current ?? slotDetails;
      return {
        ...base,
        installation: { status: "publishing" },
      };
    },
  );

  return { slotDetails: updated, publishCommandSent: true };
}

function getSnippetContentPayload(
  body: Record<string, unknown>,
): SnippetContentPayload {
  return {
    snippet_id: asString(body["snippet_id"]) ?? "",
    version: Number(body["version"] ?? 0),
    status: asString(body["status"]) === "active" ? "active" : "inactive",
    image_url: asString(body["image_url"]),
    action_url:
      asString(body["action_url"]) ?? asString(body["click_tracking_url"]),
    write_up: asString(body["write_up"]),
  };
}

function applySignedSnippetContentUpdate(
  slotDetails: SellerSlotDetails,
  currentContent: SnippetContentRecord,
  payload: SnippetContentPayload,
  signatureHex: string,
): SnippetContentRecord {
  if (payload.snippet_id !== slotDetails.snippet_id) {
    throw new Error("payload snippet_id does not match slot details");
  }
  if (!Number.isInteger(payload.version) || payload.version < 1) {
    throw new Error("version must be an integer >= 1");
  }
  if (payload.version <= currentContent.version) {
    throw new Error("snippet content version must increase monotonically");
  }
  if (payload.status === "active" && !payload.image_url) {
    throw new Error("image_url is required when status is active");
  }

  const contentHashHex = hashSnippetContentPayload(payload);
  if (
    !verifySnippetContentSignature(
      contentHashHex,
      signatureHex,
      lookupSlotSignerPubkey(slotDetails),
    )
  ) {
    throw new Error("invalid snippet content signature");
  }

  const record: SnippetContentRecord = {
    schema_version: 1,
    snippet_id: slotDetails.snippet_id,
    version: payload.version,
    status: payload.status,
    image_url: payload.image_url,
    action_url: payload.action_url,
    write_up: payload.write_up,
    updated_at: nowIso(),
  };

  writeRecord("snippet_content", slotDetails.snippet_id, record);
  return record;
}

router.get("/image", (req: Request, res: Response) => {
  const context = resolveTrackingContext(req.query as Record<string, unknown>);
  try {
    recordTrackingEvent("impression", context, req);
  } catch {
    // best effort
  }

  if (context.booking_id) {
    const booking = readRecord<BookingTrackingRegistration>(
      "bookings",
      context.booking_id,
    );
    if (booking?.image_url) {
      res.redirect(302, booking.image_url);
      return;
    }
  }

  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.send(TRANSPARENT_PNG);
});

router.get("/click", (req: Request, res: Response) => {
  const context = resolveTrackingContext(req.query as Record<string, unknown>);

  try {
    recordTrackingEvent("click", context, req);
  } catch {
    // best effort
  }

  if (String(req.query["ping"] ?? "") === "1") {
    res.status(204).end();
    return;
  }

  res.redirect(
    302,
    context.destination_url ? decodeURIComponent(context.destination_url) : "/",
  );
});

router.get("/stats/:id", (req: Request, res: Response) => {
  const metricId = String(req.params.id);
  const metrics =
    readMetrics(metricId) ??
    ({
      schema_version: 1,
      metric_id: metricId,
      impressions: 0,
      clicks: 0,
      geo_impressions: {},
      geo_clicks: {},
    } satisfies MetricsRecord);

  const ctr =
    metrics.impressions > 0 ? metrics.clicks / metrics.impressions : 0;
  res.json({
    metric_id: metrics.metric_id,
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    ctr: +ctr.toFixed(4),
    geo_impressions: metrics.geo_impressions,
    geo_clicks: metrics.geo_clicks,
  });
});

async function handleSnippetSeen(req: Request, res: Response): Promise<void> {
  const snippetId =
    asString(req.query["snippet_id"]) ??
    asString(req.body?.snippet_id) ??
    asString(req.query["id"]) ??
    "";

  if (!snippetId) {
    res.status(400).json({ error: "snippet_id is required" });
    return;
  }

  try {
    const result = await markSnippetSeen(snippetId);
    if (req.method === "GET") {
      res.status(204).end();
      return;
    }
    res.json({
      snippet_id: result.slotDetails.snippet_id,
      status: result.slotDetails.installation.status,
      publish_command_sent: result.publishCommandSent,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message === "slot details not found" ? 404 : 502).json({
      error: message,
    });
  }
}

router.get("/snippet-seen", (req: Request, res: Response) => {
  void handleSnippetSeen(req, res);
});

router.post("/snippet-seen", (req: Request, res: Response) => {
  void handleSnippetSeen(req, res);
});

router.post("/bookings/register", (req: Request, res: Response) => {
  const bookingId = makeId("book");
  const imageUrl = asString(req.body?.image_url) ?? "";
  const destinationUrl =
    asString(req.body?.destination_url) ?? asString(req.body?.click_url) ?? "";

  const booking: BookingTrackingRegistration = {
    schema_version: 1,
    booking_id: bookingId,
    image_url: imageUrl,
    destination_url: destinationUrl,
    tracked_image_url:
      asString(req.body?.tracked_image_url) ?? buildTrackedImageUrl(bookingId),
    tracked_click_url:
      asString(req.body?.tracked_click_url) ??
      buildBookingClickTrackingUrl(bookingId),
    created_at: nowIso(),
  };
  writeRecord("bookings", bookingId, booking);

  res.status(201).json(booking);
});

router.get("/bookings/:id", (req: Request, res: Response) => {
  const bookingId = String(req.params.id);
  const booking = readRecord<BookingTrackingRegistration>(
    "bookings",
    bookingId,
  );
  if (!booking) {
    res.status(404).json({ error: "booking tracking record not found" });
    return;
  }

  const metrics =
    readMetrics(bookingId) ??
    ({
      schema_version: 1,
      metric_id: bookingId,
      impressions: 0,
      clicks: 0,
      geo_impressions: {},
      geo_clicks: {},
    } satisfies MetricsRecord);

  res.json({ ...booking, metrics });
});

router.post("/snippet-content", (req: Request, res: Response) => {
  const payload = getSnippetContentPayload(req.body as Record<string, unknown>);
  if (!payload.snippet_id) {
    res.status(400).json({ error: "snippet_id is required" });
    return;
  }

  const slotDetails = readSlotDetails(payload.snippet_id);
  if (!slotDetails) {
    res.status(404).json({ error: "slot details not found" });
    return;
  }

  const signatureHex = asString(req.body?.signature) ?? "";
  if (!signatureHex) {
    res.status(400).json({ error: "signature is required" });
    return;
  }

  try {
    const content = applySignedSnippetContentUpdate(
      slotDetails,
      readSnippetContent(payload.snippet_id),
      payload,
      signatureHex,
    );
    res.json({
      updated: true,
      snippet_id: content.snippet_id,
      version: content.version,
      status: content.status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

router.delete("/snippet/active", (_req: Request, res: Response) => {
  res.status(410).json({
    error:
      "snippet/active is deprecated; submit a signed /tracking/snippet-content update with status='inactive'",
  });
});

router.get("/snippet/loader.js", (req: Request, res: Response) => {
  const snippetId = String(req.query["id"] ?? "");
  res.set("Content-Type", "application/javascript");
  res.set("Cache-Control", "no-store");

  if (!snippetId) {
    res.send("/* payspace: missing ?id= query parameter */");
    return;
  }

  const slotDetails = readSlotDetails(snippetId);
  if (!slotDetails) {
    res.send("/* payspace: unknown snippet */");
    return;
  }

  const content = readSnippetContent(snippetId);
  const dimensions = parseDimensions(slotDetails.dimensions);

  const data = JSON.stringify({
    snippetId: slotDetails.snippet_id,
    status: content.status,
    imageUrl: content.image_url,
    actionUrl: content.action_url,
    writeUp: content.write_up,
    widthPx: dimensions.widthPx,
    heightPx: dimensions.heightPx,
    sellerImpressionTrackingUrl: buildSnippetImpressionTrackingUrl(
      slotDetails.snippet_id,
    ),
    sellerSnippetSeenUrl: buildSnippetSeenUrl(slotDetails.snippet_id),
    sellerClickTrackingUrl: buildSnippetClickTrackingUrl(
      slotDetails.snippet_id,
    ),
  });

  res.send(`(function(){
var d=${data};
function ping(url){
  if(!url)return;
  try{
    if(window.fetch){
      window.fetch(url,{method:'GET',mode:'no-cors',keepalive:true,credentials:'omit'}).catch(function(){});
      return;
    }
  }catch(_){}
  try{
    var px=new Image();
    px.referrerPolicy='no-referrer-when-downgrade';
    px.src=url;
  }catch(_){}
}
var el=document.getElementById(d.snippetId);
if(!el)return;
ping(d.sellerSnippetSeenUrl);
el.style.display='block';
el.style.width='100%';
el.style.overflow='hidden';
if(d.widthPx){ el.style.maxWidth=d.widthPx+'px'; }
if(d.status==='active'){
  el.innerHTML='';
  if(d.widthPx&&d.heightPx){ el.style.aspectRatio=''+d.widthPx+' / '+d.heightPx; }
  if(d.heightPx){ el.style.minHeight=d.heightPx+'px'; }
  var a=document.createElement('a');
  a.href=d.actionUrl||'#';
  a.target='_blank';
  a.rel='noopener noreferrer';
  a.addEventListener('click',function(){ ping(d.sellerClickTrackingUrl); });
  var img=document.createElement('img');
  img.src=d.imageUrl||'';
  img.alt=d.writeUp||'';
  img.style.cssText='width:100%;height:100%;display:block;border:0;object-fit:contain;';
  a.appendChild(img);
  el.appendChild(a);
  ping(d.sellerImpressionTrackingUrl);
}else{
  el.innerHTML='';
  el.style.minHeight='1px';
}
})();`);
});

router.get("/slot-details/:id", (req: Request, res: Response) => {
  const snippetId = String(req.params.id);
  const slotDetails = readSlotDetails(snippetId);
  if (!slotDetails) {
    res.status(404).json({ error: "slot details not found" });
    return;
  }

  res.json({
    slot_details: slotDetails,
    content: readSnippetContent(snippetId),
    seller_impression_tracking_url: buildSnippetImpressionTrackingUrl(
      slotDetails.snippet_id,
    ),
    seller_click_tracking_url: buildSnippetClickTrackingUrl(
      slotDetails.snippet_id,
    ),
    snippet_seen_url: buildSnippetSeenUrl(slotDetails.snippet_id),
    loader_url: buildTrackingUrl("/tracking/snippet/loader.js", {
      id: slotDetails.snippet_id,
    }),
    embed_html: buildEmbedHtml(slotDetails.snippet_id),
  });
});

router.get("/snippet/:id", (req: Request, res: Response) => {
  const snippetId = String(req.params.id);
  const slotDetails = readSlotDetails(snippetId);
  if (!slotDetails) {
    res.status(404).json({ error: "slot details not found" });
    return;
  }

  res.json({
    slot_details: slotDetails,
    content: readSnippetContent(snippetId),
    seller_impression_tracking_url: buildSnippetImpressionTrackingUrl(
      slotDetails.snippet_id,
    ),
    seller_click_tracking_url: buildSnippetClickTrackingUrl(
      slotDetails.snippet_id,
    ),
    snippet_seen_url: buildSnippetSeenUrl(slotDetails.snippet_id),
    loader_url: buildTrackingUrl("/tracking/snippet/loader.js", {
      id: slotDetails.snippet_id,
    }),
    embed_html: buildEmbedHtml(slotDetails.snippet_id),
  });
});

export default router;
