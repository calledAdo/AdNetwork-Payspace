import crypto from "node:crypto";
import type { Request } from "express";
import { config } from "../../config.js";
import { readRecord, updateRecord, writeRecord } from "../../store.js";
import type {
  BookingService,
  BookingTrackingRegistration,
  MetricsRecord,
  TrackingContext,
  TrackingEventType,
} from "../types.js";

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
      currentRaw ??
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

export function createBookingService(
  deps: {
    readSnippetExists: (snippetId: string) => boolean;
  },
): BookingService {
  return {
    buildSnippetImpressionTrackingUrl(snippetId: string): string {
      return buildTrackingUrl("/tracking/image", { snippet_id: snippetId });
    },
    buildSnippetClickTrackingUrl(snippetId: string): string {
      return buildTrackingUrl("/tracking/click", {
        snippet_id: snippetId,
        ping: "1",
      });
    },
    buildLoaderUrl(snippetId: string): string {
      return buildTrackingUrl("/tracking/snippet/loader.js", { id: snippetId });
    },
    buildEmbedHtml(snippetId: string): string {
      const loaderUrl = buildTrackingUrl("/tracking/snippet/loader.js", {
        id: snippetId,
      });
      return [
        `<div id="${snippetId}"></div>`,
        `<script async src="${loaderUrl}" crossorigin="anonymous"></script>`,
      ].join("\n");
    },
    buildBookingClickTrackingUrl(bookingId: string): string {
      return buildTrackingUrl("/tracking/click", { booking_id: bookingId });
    },
    buildBookingImpressionTrackingUrl(bookingId: string): string {
      return buildTrackingUrl("/tracking/image", { booking_id: bookingId });
    },
    registerBooking(input: Record<string, unknown>): BookingTrackingRegistration {
      const bookingId = makeId("book");
      const imageUrl = asString(input["image_url"]) ?? "";
      const destinationUrl =
        asString(input["destination_url"]) ?? asString(input["click_url"]) ?? "";
      const record: BookingTrackingRegistration = {
        schema_version: 1,
        booking_id: bookingId,
        image_url: imageUrl,
        destination_url: destinationUrl,
        tracked_image_url:
          asString(input["tracked_image_url"]) ??
          buildTrackingUrl("/tracking/image", { booking_id: bookingId }),
        tracked_click_url:
          asString(input["tracked_click_url"]) ??
          buildTrackingUrl("/tracking/click", { booking_id: bookingId }),
        created_at: nowIso(),
      };
      writeRecord("bookings", bookingId, record);
      return record;
    },
    resolveContext(input: Record<string, unknown>): TrackingContext {
      const context: TrackingContext = {
        snippet_id: asString(input["snippet_id"]),
        booking_id: asString(input["booking_id"]),
        destination_url: asString(input["url"]),
      };

      const legacyId = asString(input["id"]);
      if (legacyId) {
        const booking = readRecord<BookingTrackingRegistration>("bookings", legacyId);
        if (booking) {
          context.booking_id ??= booking.booking_id;
          context.destination_url ??= booking.destination_url;
        }
        if (!context.snippet_id && deps.readSnippetExists(legacyId)) {
          context.snippet_id = legacyId;
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
    },
    recordTrackingEvent(
      type: TrackingEventType,
      context: TrackingContext,
      req: Request,
    ): void {
      const country = resolveCountry(req);
      if (context.snippet_id) bumpMetrics(context.snippet_id, type, country);
      if (context.booking_id) bumpMetrics(context.booking_id, type, country);
    },
    getMetrics(metricId: string): MetricsRecord {
      return (
        readMetrics(metricId) ??
        ({
          schema_version: 1,
          metric_id: metricId,
          impressions: 0,
          clicks: 0,
          geo_impressions: {},
          geo_clicks: {},
        } satisfies MetricsRecord)
      );
    },
    getBooking(bookingId: string): BookingTrackingRegistration | null {
      return readRecord<BookingTrackingRegistration>("bookings", bookingId);
    },
  };
}

