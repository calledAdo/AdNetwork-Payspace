import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Layers,
  DollarSign,
  TrendingUp,
  CheckCircle2,
  ExternalLink,
  Plus,
  MessagesSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentChatFab } from "@/components/AgentChatFab";
import {
  fetchPublisher,
  fetchPublisherMetrics,
  fetchPublisherSlots,
} from "@/lib/api";

export default function PublisherDashboard() {
  const [searchParams] = useSearchParams();
  const ownerPubkey = searchParams.get("ownerPubkey") ?? "";

  const publisherQuery = useQuery({
    queryKey: ["publisher", ownerPubkey],
    queryFn: () => fetchPublisher(ownerPubkey),
    enabled: !!ownerPubkey,
  });

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

  const publisher = publisherQuery.data;
  const slots = slotsQuery.data?.slots ?? [];
  const stats = metricsQuery.data?.stats;

  const metrics = [
    {
      label: "Total Revenue",
      value: stats?.total_revenue_udt ? `${stats.total_revenue_udt} UDT` : "0 UDT",
      icon: DollarSign,
      color: "text-primary",
    },
    {
      label: "Slots Total",
      value: String(stats?.slots_total ?? slots.length ?? 0),
      icon: Layers,
      color: "text-accent",
    },
    {
      label: "Slots Active",
      value: String(stats?.slots_active ?? 0),
      icon: TrendingUp,
      color: "text-success",
    },
    {
      label: "Agent Status",
      value: publisher?.agent_status ?? "none",
      icon: CheckCircle2,
      color: "text-success",
    },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto pb-24">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Inventory Hub</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {publisher
              ? `Publisher ${publisher.owner_pubkey}`
              : "Open a publisher from onboarding to inspect real inventory state."}
          </p>
        </div>
        <Link to={ownerPubkey ? `/publisher/new-placement?ownerPubkey=${encodeURIComponent(ownerPubkey)}` : "/publisher/onboard"}>
          <Button className="gap-2 bg-accent text-accent-foreground hover:bg-accent/90">
            <Plus className="h-4 w-4" /> Add Slot
          </Button>
        </Link>
      </div>

      {!ownerPubkey && (
        <div className="glass rounded-2xl p-6 text-sm text-muted-foreground">
          No publisher selected yet. Create a publisher profile first, then return here with its `ownerPubkey`.
        </div>
      )}

      {(publisherQuery.error || slotsQuery.error || metricsQuery.error) && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {(publisherQuery.error instanceof Error && publisherQuery.error.message) ||
            (slotsQuery.error instanceof Error && slotsQuery.error.message) ||
            (metricsQuery.error instanceof Error && metricsQuery.error.message)}
        </div>
      )}

      {publisher && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="glass rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">
                    {metric.label}
                  </span>
                  <metric.icon className={`h-4 w-4 ${metric.color}`} />
                </div>
                <p className="text-2xl font-bold">{metric.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="glass rounded-xl p-5">
              <h2 className="text-sm font-medium mb-4 text-muted-foreground">
                Publisher Profile
              </h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Owner</span>
                  <span className="font-mono text-xs">{publisher.owner_pubkey}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Site URL</span>
                  <span className="font-mono text-xs break-all text-right">{publisher.site_url}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Block</span>
                  <span>{publisher.block_id ?? "unassigned"}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Agent Status</span>
                  <span>{publisher.agent_status}</span>
                </div>
              </div>
            </div>

            <div className="glass rounded-xl p-5">
              <h2 className="text-sm font-medium mb-4 text-muted-foreground">
                Slot Inventory
              </h2>
              <p className="text-sm text-muted-foreground">
                Slots are now created through the slot-first workflow and synchronized to the seller agent with `register_slot`.
              </p>
              <div className="mt-4 text-sm">
                <span className="text-muted-foreground">Registered slots:</span>{" "}
                <span className="font-semibold">{slots.length}</span>
              </div>
            </div>
          </div>

          <div className="glass rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-muted-foreground">
                Seller Slots
              </h2>
              <span className="text-xs text-muted-foreground">{slots.length} entries</span>
            </div>

            {slots.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No slots have been registered yet.
              </p>
            ) : (
              <div className="space-y-3">
                {slots.map((slot) => (
                  <Link
                    key={slot.snippet_id}
                    to={`/publisher/placement/${encodeURIComponent(slot.snippet_id)}${ownerPubkey ? `?ownerPubkey=${encodeURIComponent(ownerPubkey)}` : ""}`}
                    className="block p-4 rounded-xl bg-background/40 border border-border/30 hover:border-accent/40 transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium group-hover:text-accent transition-colors">
                          {slot.snippet_id}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {slot.page_url || "No page URL"} • {slot.dimensions || "No dimensions"}
                        </p>
                      </div>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-accent transition-colors mt-1" />
                    </div>

                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-xs">
                      <div className="rounded-lg border border-border/30 bg-background/40 p-3">
                        <div className="text-muted-foreground uppercase tracking-wide">Install</div>
                        <div className="mt-1 font-medium">{slot.installation.status}</div>
                        <div className="mt-1 text-muted-foreground">page: {slot.page_url || "—"}</div>
                      </div>
                      <div className="rounded-lg border border-border/30 bg-background/40 p-3">
                        <div className="text-muted-foreground uppercase tracking-wide">Pricing</div>
                        <div className="mt-1 font-medium">{slot.min_amount_per_1000} / 1000</div>
                        <div className="mt-1 text-muted-foreground">mode: {slot.publication_mode}</div>
                      </div>
                      <div className="rounded-lg border border-border/30 bg-background/40 p-3">
                        <div className="text-muted-foreground uppercase tracking-wide">Placement</div>
                        <div className="mt-1 font-medium">{slot.dimensions || "—"}</div>
                        <div className="mt-1 text-muted-foreground">position: {slot.ad_position}</div>
                      </div>
                      <div className="rounded-lg border border-border/30 bg-background/40 p-3">
                        <div className="text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                          <MessagesSquare className="h-3.5 w-3.5" />
                          Runtime
                        </div>
                        <div className="mt-1 font-medium">slot detail view</div>
                        <div className="mt-1 text-muted-foreground">booking history and conversations</div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <AgentChatFab
        agentName="Seller Agent"
        agentId={publisher?.agent_pubkey ?? "seller-agent"}
        agentType="seller"
        subjectType={ownerPubkey ? "seller_profile" : undefined}
        subjectId={ownerPubkey || undefined}
        initialMessage="Open a publisher first, then this panel will route directly to the hosted seller agent."
      />
    </div>
  );
}
