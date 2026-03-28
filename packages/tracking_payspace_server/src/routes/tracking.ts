import { Router, type Request, type Response } from "express";
import { getPluginRegistry } from "../plugins/registry.js";
import type { SnippetContentPayload } from "../plugins/types.js";

const router = Router();
const plugins = getPluginRegistry();

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toSnippetPayload(body: Record<string, unknown>): SnippetContentPayload {
  return {
    snippet_id: asString(body["snippet_id"]) ?? "",
    version: Number(body["version"] ?? 0),
    image_url: asString(body["image_url"]),
    destination_url:
      asString(body["destination_url"]) ??
      asString(body["action_url"]) ??
      asString(body["click_tracking_url"]),
    writeup: asString(body["writeup"]) ?? asString(body["write_up"]),
  };
}

router.get("/image", (req: Request, res: Response) => {
  const context = plugins.booking.resolveContext(req.query as Record<string, unknown>);
  if (context.snippet_id) {
    plugins.snippet.activateOnImpression(context.snippet_id);
  }
  try {
    plugins.booking.recordTrackingEvent("impression", context, req);
  } catch {
    // best effort
  }

  if (context.booking_id) {
    const booking = plugins.booking.getBooking(context.booking_id);
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
  const context = plugins.booking.resolveContext(req.query as Record<string, unknown>);
  try {
    plugins.booking.recordTrackingEvent("click", context, req);
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
  const metrics = plugins.booking.getMetrics(metricId);
  const ctr = metrics.impressions > 0 ? metrics.clicks / metrics.impressions : 0;
  res.json({
    metric_id: metrics.metric_id,
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    ctr: +ctr.toFixed(4),
    geo_impressions: metrics.geo_impressions,
    geo_clicks: metrics.geo_clicks,
  });
});

router.get("/snippet-seen", (req: Request, res: Response) => {
  res.status(410).json({
    error: "snippet-seen is deprecated in tracking-only backend",
  });
});

router.post("/snippet-seen", (req: Request, res: Response) => {
  res.status(410).json({
    error: "snippet-seen is deprecated in tracking-only backend",
  });
});

router.post("/bookings/register", (req: Request, res: Response) => {
  const booking = plugins.booking.registerBooking(
    (req.body ?? {}) as Record<string, unknown>,
  );
  res.status(201).json(booking);
});

router.get("/bookings/:id", (req: Request, res: Response) => {
  const bookingId = String(req.params.id);
  const booking = plugins.booking.getBooking(bookingId);
  if (!booking) {
    res.status(404).json({ error: "booking tracking record not found" });
    return;
  }
  const metrics = plugins.booking.getMetrics(bookingId);
  res.json({ ...booking, metrics });
});

router.post("/snippet-content", (req: Request, res: Response) => {
  const payload = toSnippetPayload((req.body ?? {}) as Record<string, unknown>);
  if (!payload.snippet_id) {
    res.status(400).json({ error: "snippet_id is required" });
    return;
  }

  const signatureHex = asString(req.body?.signature) ?? "";
  if (!signatureHex) {
    res.status(400).json({ error: "signature is required" });
    return;
  }

  try {
    const content = plugins.snippet.updateSignedContent(payload, signatureHex);
    res.json({
      updated: true,
      snippet_id: content.snippet_id,
      version: content.version,
      status: content.status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === "snippet not found" ? 404 : 400;
    res.status(status).json({ error: message });
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

  const data = plugins.snippet.getLoaderView(snippetId);
  if (!data) {
    res.send("/* payspace: unknown snippet */");
    return;
  }

  const serialized = JSON.stringify(data);
  res.send(`(function(){
var d=${serialized};
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
ping(d.sellerImpressionTrackingUrl);
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
}else{
  el.innerHTML='';
  el.style.minHeight='1px';
}
})();`);
});

router.get("/slot-details/:id", (req: Request, res: Response) => {
  const snippetId = String(req.params.id);
  const view = plugins.snippet.getRouteView(snippetId);
  if (!view) {
    res.status(404).json({ error: "snippet not found" });
    return;
  }
  res.json(view);
});

router.get("/snippet/:id", (req: Request, res: Response) => {
  const snippetId = String(req.params.id);
  const view = plugins.snippet.getRouteView(snippetId);
  if (!view) {
    res.status(404).json({ error: "snippet not found" });
    return;
  }
  res.json(view);
});

export default router;

