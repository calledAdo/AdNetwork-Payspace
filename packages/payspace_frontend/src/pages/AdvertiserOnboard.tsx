import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createCampaign } from "@/lib/api";
import { AssistantThreadPanel } from "@/components/AssistantThreadPanel";
import { useWalletIdentity } from "@/hooks/useWalletIdentity";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AssistantDraftEnvelope } from "@/lib/assistantDraft";

type CreatedCampaign = {
  campaign_id: string;
  agent_status: string;
  message: string;
};

export default function AdvertiserOnboard() {
  const walletState = useWalletIdentity();
  const [ownerPubkey, setOwnerPubkey] = useState("");
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [maxCpm, setMaxCpm] = useState("");
  const [keywordFlags, setKeywordFlags] = useState("1");
  const [adPosition, setAdPosition] = useState("0");
  const [blockId, setBlockId] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [clickUrl, setClickUrl] = useState("");
  const [writeUp, setWriteUp] = useState("");
  const [created, setCreated] = useState<CreatedCampaign | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftDialogOpen, setDraftDialogOpen] = useState(false);
  const resolvedOwnerPubkey = walletState.identity ?? ownerPubkey;

  const applyDraft = (draft: AssistantDraftEnvelope | null) => {
    if (!draft || draft.draft_type !== "campaign_init") return;
    const payload = draft.payload;
    if (typeof payload["owner_pubkey"] === "string") setOwnerPubkey(payload["owner_pubkey"]);
    if (typeof payload["name"] === "string") setName(payload["name"]);
    if (typeof payload["total_budget_udt"] === "string") setBudget(payload["total_budget_udt"]);
    if (typeof payload["max_price_per_mille"] === "string") setMaxCpm(payload["max_price_per_mille"]);
    if (typeof payload["keyword_flags"] === "string") setKeywordFlags(payload["keyword_flags"]);
    if (typeof payload["ad_position"] === "number" || typeof payload["ad_position"] === "string") {
      setAdPosition(String(payload["ad_position"]));
    }
    const creative = payload["creative"];
    if (creative && typeof creative === "object" && !Array.isArray(creative)) {
      const typedCreative = creative as Record<string, unknown>;
      if (typeof typedCreative["image_url"] === "string") setImageUrl(typedCreative["image_url"]);
      if (typeof typedCreative["click_url"] === "string") setClickUrl(typedCreative["click_url"]);
      if (typeof typedCreative["write_up"] === "string") setWriteUp(typedCreative["write_up"]);
    }
    setDraftDialogOpen(true);
  };

  const submit = async () => {
    if (!resolvedOwnerPubkey.trim() || !name.trim() || !budget.trim() || !maxCpm.trim() || !imageUrl.trim() || !clickUrl.trim()) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await createCampaign({
        owner_pubkey: resolvedOwnerPubkey.trim(),
        name: name.trim(),
        total_budget_udt: budget.trim(),
        max_price_per_mille: maxCpm.trim(),
        keyword_flags: keywordFlags.trim() || "1",
        ad_position: Number(adPosition),
        block_id: blockId.trim() || null,
        creative: {
          image_url: imageUrl.trim(),
          click_url: clickUrl.trim(),
          write_up: writeUp.trim() || undefined,
        },
      });
      setCreated(result);
      setDraftDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 pb-20">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/30 flex items-center justify-center glow-cyan">
          <Target className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Campaign Onboarding</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Chat-first onboarding for campaign creation. A confirmation dialog appears only when the assistant believes the campaign core is complete enough to submit.
          </p>
        </div>
      </div>

      {!created && (
        <AssistantThreadPanel
          title="Campaign Planning Assistant"
          subtitle="New campaign flow • The assistant extracts the minimum fields needed for campaign_core."
          subjectType="campaign"
          subjectId={null}
          placeholder="Describe what you're advertising, your budget, target audience, and creative..."
          initialUserMessage="I want to start a campaign."
          context={{
            wallet_owner_pubkey: walletState.identity,
            wallet_address: walletState.address,
          }}
          onAssistantReply={applyDraft}
        />
      )}

      {created && (
        <div className="glass rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">Campaign created</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Campaign `{created.campaign_id}` is now registered. From here, discussion should move to the hosted buyer agent in the dashboard context.
            </p>
          </div>
          <Link to={`/advertiser/dashboard?campaignId=${encodeURIComponent(created.campaign_id)}`}>
            <Button className="gap-2 bg-accent text-accent-foreground hover:bg-accent/90">
              Open Dashboard <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      )}

      <Dialog open={draftDialogOpen} onOpenChange={setDraftDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Confirm Campaign Core</DialogTitle>
            <DialogDescription>
              Review the assistant-derived campaign payload before creation.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Owner pubkey</span>
              <Input
                value={resolvedOwnerPubkey}
                onChange={(event) => setOwnerPubkey(event.target.value)}
                placeholder="0x..."
                readOnly={!!walletState.identity}
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Campaign name</span>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="DeFi Wallet Launch" />
            </label>
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Total budget (UDT)</span>
              <Input value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="5000000" />
            </label>
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Max amount per 1000</span>
              <Input value={maxCpm} onChange={(event) => setMaxCpm(event.target.value)} placeholder="1500" />
            </label>
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Keyword flags</span>
              <Input value={keywordFlags} onChange={(event) => setKeywordFlags(event.target.value)} placeholder="1" />
            </label>
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Ad position</span>
              <Input value={adPosition} onChange={(event) => setAdPosition(event.target.value)} placeholder="0" />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Preferred block ID (optional)</span>
              <Input value={blockId} onChange={(event) => setBlockId(event.target.value)} placeholder="default" />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Creative image URL</span>
              <Input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://cdn.example/banner.png" />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Creative click URL</span>
              <Input value={clickUrl} onChange={(event) => setClickUrl(event.target.value)} placeholder="https://example.com/landing" />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Write-up (optional)</span>
              <Textarea value={writeUp} onChange={(event) => setWriteUp(event.target.value)} placeholder="Short campaign copy..." />
            </label>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDraftDialogOpen(false)}>
              Keep Editing
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={!resolvedOwnerPubkey.trim() || !name.trim() || !budget.trim() || !maxCpm.trim() || !imageUrl.trim() || !clickUrl.trim() || isSubmitting}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isSubmitting ? "Creating..." : "Confirm & Create Campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
