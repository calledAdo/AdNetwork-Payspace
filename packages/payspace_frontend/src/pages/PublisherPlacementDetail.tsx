import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ClipboardCopy,
  Code2,
  Eye,
  MessageSquareText,
  MousePointerClick,
  RadioTower,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  fetchPublisherConversation,
  fetchPublisherConversations,
  fetchPublisherMetrics,
  fetchPublisherSlots,
  fetchSnippetRecord,
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

function copyText(value: string) {
  void navigator.clipboard.writeText(value);
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

export default function PublisherPlacementDetail() {
  const { placementId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const ownerPubkey = searchParams.get("ownerPubkey") ?? "";

  const slotsQuery = useQuery({
    queryKey: ["publisher-slots", ownerPubkey],
    queryFn: () => fetchPublisherSlots(ownerPubkey),
    enabled: !!ownerPubkey,
  });

  const metricsQuery = useQuery({
    queryKey: ["publisher-metrics", ownerPubkey],
    queryFn: () => fetchPublisherMetrics(ownerPubkey),
    enabled: !!ownerPubkey,
  });

  const conversationsQuery = useQuery({
    queryKey: ["publisher-conversations", ownerPubkey],
    queryFn: () => fetchPublisherConversations(ownerPubkey),
    enabled: !!ownerPubkey,
  });

  const snippetQuery = useQuery({
    queryKey: ["snippet-record", placementId],
    queryFn: () => fetchSnippetRecord(placementId),
    enabled: !!placementId,
  });

  const trackingStatsQuery = useQuery({
    queryKey: ["snippet-stats", placementId],
    queryFn: () => fetchTrackingStats(placementId),
    enabled: !!placementId,
  });

  const slot = slotsQuery.data?.slots.find((item) => item.snippet_id === placementId) ?? null;

  const runtimeSlots = Array.isArray(metricsQuery.data?.slots) ? metricsQuery.data.slots : [];
  const runtimeSlot =
    runtimeSlots.find((entry) => {
      const record = asRecord(entry);
      const slotDetails = asRecord(record?.["slot_details"]);
      return (
        asString(record?.["snippet_id"]) === placementId ||
        asString(slotDetails?.["snippet_id"]) === placementId
      );
    }) ?? null;

  const runtimeRecord = asRecord(runtimeSlot);
  const publication = asRecord(runtimeRecord?.["publication"]);
  const currentBooking = asRecord(runtimeRecord?.["current_booking"]);
  const history = asArray(runtimeRecord?.["history"]);
  const conversationContextId = asString(currentBooking?.["context_id"]);

  const matchingConversations =
    conversationsQuery.data?.conversations.filter(
      (item) => !conversationContextId || item.contextId === conversationContextId,
    ) ?? [];

  const conversationDetailQuery = useQuery({
    queryKey: ["publisher-conversation", ownerPubkey, conversationContextId],
    queryFn: () =>
      fetchPublisherConversation(ownerPubkey, conversationContextId ?? ""),
    enabled: !!ownerPubkey && !!conversationContextId,
  });

  const conversationDetail = asRecord(conversationDetailQuery.data);
  const messages = asArray(conversationDetail?.["messages"]).slice(-6);

  const snippetRecord = snippetQuery.data;

  const summaryCards = [
    {
      label: "Install Status",
      value: slot?.installation.status ?? "unknown",
      icon: RadioTower,
    },
    {
      label: "Snippet Status",
      value: snippetRecord?.content.status ?? "inactive",
      icon: Code2,
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
      value: String(matchingConversations.length),
      icon: MessageSquareText,
    },
  ];

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto pb-24">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to={`/publisher/dashboard${ownerPubkey ? `?ownerPubkey=${encodeURIComponent(ownerPubkey)}` : ""}`}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Slot Detail</h1>
            <p className="text-sm text-muted-foreground mt-1">{placementId}</p>
          </div>
        </div>
        <Link to={ownerPubkey ? `/publisher/new-placement?ownerPubkey=${encodeURIComponent(ownerPubkey)}` : "/publisher/onboard"}>
          <Button className="bg-accent text-accent-foreground hover:bg-accent/90">
            Add Slot
          </Button>
        </Link>
      </div>

      {!ownerPubkey && (
        <div className="glass rounded-2xl p-6 text-sm text-muted-foreground">
          Missing `ownerPubkey`. Open this slot from the publisher inventory page.
        </div>
      )}

      {(slotsQuery.error ||
        metricsQuery.error ||
        conversationsQuery.error ||
        snippetQuery.error ||
        trackingStatsQuery.error ||
        conversationDetailQuery.error) && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {(slotsQuery.error instanceof Error && slotsQuery.error.message) ||
            (metricsQuery.error instanceof Error && metricsQuery.error.message) ||
            (conversationsQuery.error instanceof Error &&
              conversationsQuery.error.message) ||
            (snippetQuery.error instanceof Error && snippetQuery.error.message) ||
            (trackingStatsQuery.error instanceof Error &&
              trackingStatsQuery.error.message) ||
            (conversationDetailQuery.error instanceof Error &&
              conversationDetailQuery.error.message)}
        </div>
      )}

      {!slot && ownerPubkey && !slotsQuery.isLoading && (
        <div className="glass rounded-2xl p-6 text-sm text-muted-foreground">
          No slot record was found for this snippet id.
        </div>
      )}

      {slot && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            {summaryCards.map((card) => (
              <div key={card.label} className="glass rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">
                    {card.label}
                  </span>
                  <card.icon className="h-4 w-4 text-accent" />
                </div>
                <p className="text-xl font-bold break-all">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {summaryRows("Slot Definition", [
              { label: "Snippet ID", value: slot.snippet_id },
              { label: "Owner", value: slot.owner_pubkey },
              { label: "Page URL", value: slot.page_url },
              { label: "Dimensions", value: slot.dimensions },
              { label: "Minimum / 1000", value: slot.min_amount_per_1000 },
              { label: "Ad Position", value: slot.ad_position },
              { label: "Publication Mode", value: slot.publication_mode },
              { label: "Keyword Flags", value: slot.keyword_flags },
              { label: "Policy Text", value: slot.policy_text },
              { label: "Install Status", value: slot.installation.status },
            ])}

            {summaryRows("Tracking And Runtime", [
              { label: "Metric ID", value: trackingStatsQuery.data?.metric_id ?? placementId },
              { label: "Impressions", value: trackingStatsQuery.data?.impressions ?? 0 },
              { label: "Clicks", value: trackingStatsQuery.data?.clicks ?? 0 },
              { label: "CTR", value: trackingStatsQuery.data?.ctr ?? 0 },
              { label: "Agent Slot State", value: runtimeRecord?.["state"] },
              { label: "Placement ID", value: publication?.["placement_id"] },
              { label: "Current Context", value: currentBooking?.["context_id"] },
              { label: "Current Channel", value: currentBooking?.["channel_id"] },
            ])}
          </div>

          <div className="rounded-xl border border-border/30 bg-background/40 px-4 py-3 text-xs text-muted-foreground">
            `publication.placement_id` is the seller agent&apos;s current live BookingSpace locator. It can change after publish, booking, or release because the cell is consumed and recreated on-chain.
          </div>

          {snippetRecord && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="glass rounded-xl p-5">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h2 className="text-sm font-medium text-muted-foreground">
                    Snippet Delivery
                  </h2>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => copyText(snippetRecord.embed_html)}
                  >
                    <ClipboardCopy className="h-3.5 w-3.5" />
                    Copy Embed HTML
                  </Button>
                </div>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Loader URL</span>
                    <span className="font-mono text-xs break-all text-right">
                      {snippetRecord.loader_url}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Snippet Seen URL</span>
                    <span className="font-mono text-xs break-all text-right">
                      {snippetRecord.snippet_seen_url}
                    </span>
                  </div>
                  <pre className="mt-3 rounded-lg border border-border/30 bg-background/40 p-3 text-xs whitespace-pre-wrap break-words">
                    {snippetRecord.embed_html}
                  </pre>
                </div>
              </div>

              <div className="glass rounded-xl p-5">
                <h2 className="text-sm font-medium mb-4 text-muted-foreground">
                  Current Creative
                </h2>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Status</span>
                    <span>{snippetRecord.content.status}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Version</span>
                    <span>{snippetRecord.content.version}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Image URL</span>
                    <span className="font-mono text-xs break-all text-right">
                      {snippetRecord.content.image_url ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Action URL</span>
                    <span className="font-mono text-xs break-all text-right">
                      {snippetRecord.content.action_url ?? "—"}
                    </span>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                      Write-up
                    </div>
                    <p className="text-sm text-foreground/90">
                      {snippetRecord.content.write_up ?? "No write-up set."}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="glass rounded-xl p-5">
              <h2 className="text-sm font-medium mb-4 text-muted-foreground">
                Current Booking And History
              </h2>
              <div className="space-y-4 text-sm">
                <div className="rounded-lg border border-border/30 bg-background/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Current Booking
                  </div>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-xs">
                    {renderValue(currentBooking ?? "No active booking")}
                  </pre>
                </div>
                <div className="rounded-lg border border-border/30 bg-background/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    History
                  </div>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-xs">
                    {renderValue(history.length > 0 ? history : "No history yet")}
                  </pre>
                </div>
              </div>
            </div>

            <div className="glass rounded-xl p-5">
              <h2 className="text-sm font-medium mb-4 text-muted-foreground">
                Conversations
              </h2>
              {matchingConversations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No conversation has been recorded for this slot yet.
                </p>
              ) : (
                <div className="space-y-4">
                  {matchingConversations.map((item) => (
                    <div key={item.contextId} className="rounded-lg border border-border/30 bg-background/40 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="font-mono text-xs">{item.contextId}</span>
                        <span className="text-xs text-muted-foreground">
                          {item.status} • {item.messageCount} messages
                        </span>
                      </div>
                    </div>
                  ))}

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
          </div>
        </>
      )}
    </div>
  );
}
