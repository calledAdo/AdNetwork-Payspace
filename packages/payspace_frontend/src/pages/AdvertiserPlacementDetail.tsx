import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CircleDollarSign,
  Eye,
  MessageSquareText,
  MousePointerClick,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  fetchCampaign,
  fetchCampaignConversation,
  fetchCampaignConversations,
  fetchCampaignMetrics,
  fetchTrackingStats,
} from "@/lib/api";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function renderValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value || "—";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function summaryRows(
  title: string,
  rows: Array<{ label: string; value: unknown }>,
) {
  return (
    <div className="glass rounded-xl p-5">
      <h2 className="text-sm font-medium mb-4 text-muted-foreground">{title}</h2>
      <div className="space-y-3 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-mono text-xs break-all text-right">
              {renderValue(row.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdvertiserPlacementDetail() {
  const { placementId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get("campaignId") ?? "";

  const campaignQuery = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: () => fetchCampaign(campaignId),
    enabled: !!campaignId,
  });

  const metricsQuery = useQuery({
    queryKey: ["campaign-metrics", campaignId],
    queryFn: () => fetchCampaignMetrics(campaignId),
    enabled: !!campaignId,
  });

  const conversationsQuery = useQuery({
    queryKey: ["campaign-conversations", campaignId],
    queryFn: () => fetchCampaignConversations(campaignId),
    enabled: !!campaignId,
  });

  const placements = Array.isArray(metricsQuery.data?.placements)
    ? metricsQuery.data?.placements
    : [];

  const placementRecord =
    placements.find((entry) => {
      const record = asRecord(entry);
      const discovery = asRecord(record?.["discovery"]);
      return (
        asString(discovery?.["placement_id"]) === placementId ||
        asString(record?.["placement_id"]) === placementId
      );
    }) ?? null;

  const record = asRecord(placementRecord);
  const discovery = asRecord(record?.["discovery"]);
  const slotDetails = asRecord(record?.["slot_details"]);
  const conversation = asRecord(record?.["conversation"]);
  const negotiation = asRecord(record?.["negotiation"]);
  const delivery = asRecord(record?.["delivery"]);
  const verification = asRecord(record?.["verification"]);
  const paymentChannel = asRecord(record?.["payment_channel"]);
  const payments = asRecord(record?.["payments"]);
  const tasks = asRecord(record?.["tasks"]);

  const contextId = asString(conversation?.["context_id"]);
  const bookingId = asString(delivery?.["booking_id"]);

  const placementConversationSummaries =
    conversationsQuery.data?.conversations.filter(
      (item) => !contextId || item.contextId === contextId,
    ) ?? [];

  const conversationDetailQuery = useQuery({
    queryKey: ["campaign-conversation", campaignId, contextId],
    queryFn: () => fetchCampaignConversation(campaignId, contextId ?? ""),
    enabled: !!campaignId && !!contextId,
  });

  const trackingStatsQuery = useQuery({
    queryKey: ["booking-stats", bookingId],
    queryFn: () => fetchTrackingStats(bookingId ?? ""),
    enabled: !!bookingId,
  });

  const conversationDetail = asRecord(conversationDetailQuery.data);
  const messages = asArray(conversationDetail?.["messages"]).slice(-6);

  const summaryCards = [
    {
      label: "State",
      value: renderValue(record?.["state"] ?? "unknown"),
      icon: WalletCards,
    },
    {
      label: "Spent",
      value: `${asString(payments?.["last_ticket_seller_claim"]) ?? "0"}`,
      icon: CircleDollarSign,
    },
    {
      label: "Impressions",
      value: String(trackingStatsQuery.data?.impressions ?? 0),
      icon: Eye,
    },
    {
      label: "Clicks",
      value: String(trackingStatsQuery.data?.clicks ?? 0),
      icon: MousePointerClick,
    },
    {
      label: "Conversations",
      value: String(placementConversationSummaries.length),
      icon: MessageSquareText,
    },
  ];

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto pb-24">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to={`/advertiser/dashboard${campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : ""}`}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Placement Detail</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {placementId}
            </p>
          </div>
        </div>
        <Link to="/advertiser/onboard">
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            Create Campaign
          </Button>
        </Link>
      </div>

      {!campaignId && (
        <div className="glass rounded-2xl p-6 text-sm text-muted-foreground">
          Missing `campaignId`. Open this placement from the campaign inventory page.
        </div>
      )}

      {(campaignQuery.error ||
        metricsQuery.error ||
        conversationsQuery.error ||
        conversationDetailQuery.error ||
        trackingStatsQuery.error) && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {(campaignQuery.error instanceof Error && campaignQuery.error.message) ||
            (metricsQuery.error instanceof Error && metricsQuery.error.message) ||
            (conversationsQuery.error instanceof Error &&
              conversationsQuery.error.message) ||
            (conversationDetailQuery.error instanceof Error &&
              conversationDetailQuery.error.message) ||
            (trackingStatsQuery.error instanceof Error &&
              trackingStatsQuery.error.message)}
        </div>
      )}

      {campaignId && !placementRecord && !metricsQuery.isLoading && (
        <div className="glass rounded-2xl p-6 text-sm text-muted-foreground">
          No placement record was found for this placement id inside the selected campaign.
        </div>
      )}

      {placementRecord && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            {summaryCards.map((card) => (
              <div key={card.label} className="glass rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">
                    {card.label}
                  </span>
                  <card.icon className="h-4 w-4 text-primary" />
                </div>
                <p className="text-xl font-bold break-all">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {summaryRows("Placement Locator", [
              { label: "Placement ID", value: placementId },
              { label: "Tx Hash", value: discovery?.["placement_tx_hash"] },
              { label: "Index", value: discovery?.["placement_index"] },
              { label: "Seller Pubkey", value: discovery?.["seller_pubkey"] },
              { label: "Seller A2A", value: discovery?.["seller_a2a_url"] },
              { label: "State", value: record?.["state"] },
            ])}

            {summaryRows("Slot Details", [
              { label: "Snippet ID", value: slotDetails?.["snippet_id"] },
              { label: "Page URL", value: slotDetails?.["page_url"] },
              { label: "Dimensions", value: slotDetails?.["dimensions"] },
              { label: "Minimum / 1000", value: slotDetails?.["min_amount_per_1000"] },
              { label: "Ad Position", value: slotDetails?.["ad_position"] },
              { label: "Publication Mode", value: slotDetails?.["publication_mode"] },
              { label: "Keyword Flags", value: slotDetails?.["keyword_flags"] },
              { label: "Policy Text", value: slotDetails?.["policy_text"] },
            ])}

            {summaryRows("Delivery And Verification", [
              { label: "Booking ID", value: bookingId },
              { label: "Live URL", value: delivery?.["live_url"] },
              { label: "Element ID", value: delivery?.["element_id"] },
              { label: "Verification Result", value: verification?.["last_result"] },
              { label: "Last Verified", value: verification?.["last_verified_at"] },
              { label: "Verification Failures", value: verification?.["verification_failures"] },
            ])}

            {summaryRows("Payment And Channel", [
              { label: "Agreed / 1000", value: negotiation?.["agreed_price_per_mille"] },
              { label: "Channel ID", value: paymentChannel?.["channel_id"] },
              { label: "Channel Tx Hash", value: paymentChannel?.["channel_tx_hash"] },
              { label: "Locked UDT", value: paymentChannel?.["total_udt_locked"] },
              { label: "Last Seller Claim", value: payments?.["last_ticket_seller_claim"] },
              { label: "Last Ticket Timestamp", value: payments?.["last_ticket_timestamp"] },
            ])}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="glass rounded-xl p-5">
              <h2 className="text-sm font-medium mb-4 text-muted-foreground">
                Tracking Metrics
              </h2>
              {trackingStatsQuery.data ? (
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Metric ID</span>
                    <span className="font-mono text-xs">{trackingStatsQuery.data.metric_id}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Impressions</span>
                    <span>{trackingStatsQuery.data.impressions}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Clicks</span>
                    <span>{trackingStatsQuery.data.clicks}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">CTR</span>
                    <span>{trackingStatsQuery.data.ctr}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No booking metrics have been recorded yet.
                </p>
              )}
              <p className="mt-4 text-xs text-muted-foreground">
                The discovered `placement_id` is the initial live locator. After the seller books the slot on-chain, the seller&apos;s current published outpoint may change.
              </p>
            </div>

            <div className="glass rounded-xl p-5">
              <h2 className="text-sm font-medium mb-4 text-muted-foreground">
                Tasks
              </h2>
              {tasks && Object.keys(tasks).length > 0 ? (
                <div className="space-y-3 text-sm">
                  {Object.entries(tasks).map(([key, value]) => (
                    <div key={key} className="rounded-lg border border-border/30 bg-background/40 p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        {key}
                      </div>
                      <pre className="mt-2 text-xs whitespace-pre-wrap break-words text-foreground/90">
                        {renderValue(value)}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No task records are currently stored for this placement.
                </p>
              )}
            </div>
          </div>

          <div className="glass rounded-xl p-5">
            <h2 className="text-sm font-medium mb-4 text-muted-foreground">
              Conversations
            </h2>

            {placementConversationSummaries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No conversation has been recorded for this placement yet.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="space-y-3">
                  {placementConversationSummaries.map((item) => (
                    <div key={item.contextId} className="rounded-lg border border-border/30 bg-background/40 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="font-mono text-xs">{item.contextId}</span>
                        <span className="text-xs text-muted-foreground">
                          {item.status} • {item.messageCount} messages
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {messages.length > 0 && (
                  <div className="space-y-3">
                    {messages.map((message, index) => {
                      const msg = asRecord(message);
                      return (
                        <div key={index} className="rounded-lg border border-border/30 bg-background/40 p-3 text-sm">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            {renderValue(msg?.["role"] ?? msg?.["sender"] ?? "message")}
                          </div>
                          <pre className="mt-2 whitespace-pre-wrap break-words text-foreground/90">
                            {renderValue(msg?.["content"] ?? msg)}
                          </pre>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
