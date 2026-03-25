import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  Eye,
  DollarSign,
  Layers,
  ExternalLink,
  ArrowRight,
  MessagesSquare,
} from "lucide-react";
import { AgentChatFab } from "@/components/AgentChatFab";
import { Button } from "@/components/ui/button";
import { fetchCampaign, fetchCampaignMetrics } from "@/lib/api";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export default function AdvertiserDashboard() {
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

  const campaign = campaignQuery.data;
  const stats = metricsQuery.data?.stats;
  const placements = Array.isArray(metricsQuery.data?.placements)
    ? metricsQuery.data?.placements ?? []
    : [];

  const summaryCards = [
    {
      label: "Impressions",
      value: stats?.total_impressions?.toLocaleString() ?? "0",
      icon: Eye,
      color: "text-primary",
    },
    {
      label: "Spent",
      value: stats?.total_spend_udt ? `${stats.total_spend_udt} UDT` : "0 UDT",
      icon: DollarSign,
      color: "text-warning",
    },
    {
      label: "Active Placements",
      value: String(stats?.active_placement_count ?? placements.length ?? 0),
      icon: Layers,
      color: "text-accent",
    },
    {
      label: "Max Amount / 1000",
      value: campaign?.campaign_core.max_price_per_mille
        ? `${campaign.campaign_core.max_price_per_mille} UDT`
        : "—",
      icon: TrendingUp,
      color: "text-success",
    },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto pb-24">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {campaign
              ? `${campaign.campaign_core.name} • current slot and booking state`
              : "Open or create a campaign to inspect current placements and slot details."}
          </p>
        </div>
        <Link to="/advertiser/onboard">
          <Button className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
            New Campaign <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      {!campaignId && (
        <div className="glass rounded-2xl p-6 text-sm text-muted-foreground">
          No campaign selected yet. Create a campaign first, then return here with its `campaignId`.
        </div>
      )}

      {campaignQuery.isLoading && (
        <div className="glass rounded-2xl p-6 text-sm text-muted-foreground">
          Loading campaign...
        </div>
      )}

      {(campaignQuery.error || metricsQuery.error) && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {(campaignQuery.error instanceof Error && campaignQuery.error.message) ||
            (metricsQuery.error instanceof Error && metricsQuery.error.message)}
        </div>
      )}

      {campaign && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {summaryCards.map((card) => (
              <div key={card.label} className="glass rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">
                    {card.label}
                  </span>
                  <card.icon className={`h-4 w-4 ${card.color}`} />
                </div>
                <p className="text-2xl font-bold">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="glass rounded-xl p-5">
              <h2 className="text-sm font-medium mb-4 text-muted-foreground">
                Campaign Core
              </h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Campaign ID</span>
                  <span className="font-mono text-xs">{campaign.campaign_core.campaign_id}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Owner</span>
                  <span className="font-mono text-xs">{campaign.campaign_core.owner_pubkey}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Budget</span>
                  <span>{campaign.campaign_core.total_budget_udt} UDT</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Keyword Flags</span>
                  <span>{campaign.campaign_core.keyword_flags}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Ad Position</span>
                  <span>{campaign.campaign_core.ad_position}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Agent Status</span>
                  <span>{campaign.agent_status}</span>
                </div>
              </div>
            </div>

            <div className="glass rounded-xl p-5">
              <h2 className="text-sm font-medium mb-4 text-muted-foreground">
                Creative
              </h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Image URL</span>
                  <span className="font-mono text-xs break-all text-right">
                    {campaign.campaign_core.creative.image_url}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Click URL</span>
                  <span className="font-mono text-xs break-all text-right">
                    {campaign.campaign_core.creative.click_url}
                  </span>
                </div>
                <div className="pt-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    Write-up
                  </p>
                  <p className="text-sm text-foreground/90">
                    {campaign.campaign_core.creative.write_up || "No write-up provided."}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="glass rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-muted-foreground">
                Active Placement State
              </h2>
              <span className="text-xs text-muted-foreground">{placements.length} entries</span>
            </div>

            {placements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No placement state has been persisted by the buyer agent yet.
              </p>
            ) : (
              <div className="space-y-3">
                {placements.map((placement, index) => {
                  const record = asRecord(placement);
                  const discovery = asRecord(record?.["discovery"]);
                  const negotiation = asRecord(record?.["negotiation"]);
                  const delivery = asRecord(record?.["delivery"]);
                  const conversation = asRecord(record?.["conversation"]);
                  const payments = asRecord(record?.["payments"]);
                  const slotDetails = asRecord(record?.["slot_details"]);
                  const placementId =
                    typeof discovery?.["placement_id"] === "string"
                      ? discovery["placement_id"]
                      : typeof record?.["placement_id"] === "string"
                        ? record["placement_id"]
                        : `placement-${index}`;

                  const contextId = asString(conversation?.["context_id"]);
                  const bookingId = asString(delivery?.["booking_id"]);
                  const snippetId = asString(slotDetails?.["snippet_id"]);
                  const spent = asString(payments?.["last_ticket_seller_claim"]) ?? "—";

                  return (
                    <Link
                      key={placementId}
                      to={`/advertiser/placement/${encodeURIComponent(placementId)}${campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : ""}`}
                      className="block p-4 rounded-xl bg-background/40 border border-border/30 hover:border-primary/40 transition-colors group"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <p className="text-sm font-medium group-hover:text-primary transition-colors">
                            {placementId}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            state: {String(record?.["state"] ?? "unknown")}
                          </p>
                        </div>
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors mt-1" />
                      </div>

                      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-xs">
                        <div className="rounded-lg border border-border/30 bg-background/40 p-3">
                          <div className="text-muted-foreground uppercase tracking-wide">Slot</div>
                          <div className="mt-1 font-medium">{snippetId ?? "Unknown"}</div>
                          <div className="mt-1 text-muted-foreground">
                            seller: {asString(discovery?.["seller_pubkey"]) ?? "—"}
                          </div>
                        </div>
                        <div className="rounded-lg border border-border/30 bg-background/40 p-3">
                          <div className="text-muted-foreground uppercase tracking-wide">Commercials</div>
                          <div className="mt-1 font-medium">
                            agreed: {String(negotiation?.["agreed_price_per_mille"] ?? "—")}
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            spent: {spent}
                          </div>
                        </div>
                        <div className="rounded-lg border border-border/30 bg-background/40 p-3">
                          <div className="text-muted-foreground uppercase tracking-wide">Delivery</div>
                          <div className="mt-1 font-medium">booking: {bookingId ?? "—"}</div>
                          <div className="mt-1 text-muted-foreground">
                            live: {asString(delivery?.["live_url"]) ?? "—"}
                          </div>
                        </div>
                        <div className="rounded-lg border border-border/30 bg-background/40 p-3">
                          <div className="text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                            <MessagesSquare className="h-3.5 w-3.5" />
                            Conversation
                          </div>
                          <div className="mt-1 font-medium">{contextId ?? "Not started"}</div>
                          <div className="mt-1 text-muted-foreground">
                            view placement details for history
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      <AgentChatFab
        agentName="Buyer Agent"
        agentId={campaign?.agent_pubkey ?? "buyer-agent"}
        agentType="buyer"
        subjectType={campaignId ? "campaign" : undefined}
        subjectId={campaignId || undefined}
        initialMessage="Open a campaign first, then this panel will route directly to the hosted buyer agent."
      />
    </div>
  );
}
