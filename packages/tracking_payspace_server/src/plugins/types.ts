import type { Request } from "express";

export type SnippetStatus = "inactive" | "active";
export type TrackingEventType = "impression" | "click";
export type SnippetSignerPolicy = "seller_agent" | "owner";

export interface SnippetRecord {
  snippet_id: string;
  owner_pubkey: string | null;
  signer_policy: SnippetSignerPolicy;
  dimensions: string | null;
  version: number;
  status: SnippetStatus;
  image_url: string | null;
  destination_url: string | null;
  writeup: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookingTrackingRegistration {
  schema_version: 1;
  booking_id: string;
  image_url: string;
  destination_url: string;
  tracked_image_url: string;
  tracked_click_url: string;
  created_at: string;
}

export interface MetricsRecord {
  schema_version: 1;
  metric_id: string;
  impressions: number;
  clicks: number;
  geo_impressions: Record<string, number>;
  geo_clicks: Record<string, number>;
}

export interface TrackingContext {
  snippet_id: string | null;
  booking_id: string | null;
  destination_url: string | null;
}

export interface SnippetContentPayload {
  snippet_id: string;
  version: number;
  image_url: string | null;
  destination_url: string | null;
  writeup: string | null;
}

export interface SnippetRouteView {
  snippet: SnippetRecord;
  seller_impression_tracking_url: string;
  seller_click_tracking_url: string;
  loader_url: string;
  embed_html: string;
}

export interface SnippetLoaderView {
  snippetId: string;
  status: SnippetStatus;
  imageUrl: string | null;
  actionUrl: string | null;
  writeUp: string | null;
  widthPx: number | null;
  heightPx: number | null;
  sellerImpressionTrackingUrl: string;
  sellerClickTrackingUrl: string;
}

export interface SnippetCreateInput {
  owner_pubkey?: string | null;
  signer_policy?: SnippetSignerPolicy;
  dimensions?: string | null;
}

export interface SnippetService {
  createStandalone(input: SnippetCreateInput): SnippetRecord;
  readSnippet(snippetId: string): SnippetRecord | null;
  activateOnImpression(snippetId: string): SnippetRecord | null;
  updateSnippetMetadata(
    snippetId: string,
    updates: Partial<Pick<SnippetRecord, "dimensions">>,
  ): SnippetRecord;
  getRouteView(snippetId: string): SnippetRouteView | null;
  getLoaderView(snippetId: string): SnippetLoaderView | null;
  updateSignedContent(
    payload: SnippetContentPayload,
    signatureHex: string,
  ): SnippetRecord;
}

export interface BookingService {
  buildSnippetImpressionTrackingUrl(snippetId: string): string;
  buildSnippetClickTrackingUrl(snippetId: string): string;
  buildLoaderUrl(snippetId: string): string;
  buildEmbedHtml(snippetId: string): string;
  buildBookingClickTrackingUrl(bookingId: string): string;
  buildBookingImpressionTrackingUrl(bookingId: string): string;
  registerBooking(input: Record<string, unknown>): BookingTrackingRegistration;
  resolveContext(input: Record<string, unknown>): TrackingContext;
  recordTrackingEvent(
    type: TrackingEventType,
    context: TrackingContext,
    req: Request,
  ): void;
  getMetrics(metricId: string): MetricsRecord;
  getBooking(bookingId: string): BookingTrackingRegistration | null;
}

export interface PluginRegistry {
  snippet: SnippetService;
  booking: BookingService;
}

