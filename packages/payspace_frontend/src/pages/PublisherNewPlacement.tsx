import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AssistantThreadPanel } from "@/components/AssistantThreadPanel";
import { createPublisherSlot } from "@/lib/api";
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

export default function PublisherNewPlacement() {
  const walletState = useWalletIdentity();
  const [searchParams] = useSearchParams();
  const ownerPubkey = searchParams.get("ownerPubkey") ?? "";
  const [snippetId, setSnippetId] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [adPosition, setAdPosition] = useState("0");
  const [publicationMode, setPublicationMode] = useState("1");
  const [keywordFlags, setKeywordFlags] = useState("0");
  const [policyText, setPolicyText] = useState("");
  const [metadataJson, setMetadataJson] = useState("{}");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdSnippetId, setCreatedSnippetId] = useState<string | null>(null);
  const [installArtifacts, setInstallArtifacts] = useState<{
    loaderUrl: string;
    embedHtml: string;
    status: string;
  } | null>(null);
  const [draftDialogOpen, setDraftDialogOpen] = useState(false);

  const canSubmit = useMemo(
    () => !!ownerPubkey && !!pageUrl.trim() && !!dimensions.trim() && !!minAmount.trim(),
    [ownerPubkey, pageUrl, dimensions, minAmount],
  );

  const applyDraft = (draft: AssistantDraftEnvelope | null) => {
    if (!draft || draft.draft_type !== "seller_slot_init") return;
    const payload = draft.payload;
    if (typeof payload["snippet_id"] === "string") setSnippetId(payload["snippet_id"]);
    if (typeof payload["page_url"] === "string") setPageUrl(payload["page_url"]);
    if (typeof payload["dimensions"] === "string") setDimensions(payload["dimensions"]);
    if (typeof payload["min_amount_per_1000"] === "string") setMinAmount(payload["min_amount_per_1000"]);
    if (typeof payload["ad_position"] === "number" || typeof payload["ad_position"] === "string") {
      setAdPosition(String(payload["ad_position"]));
    }
    if (typeof payload["publication_mode"] === "number" || typeof payload["publication_mode"] === "string") {
      setPublicationMode(String(payload["publication_mode"]));
    }
    if (typeof payload["keyword_flags"] === "string") setKeywordFlags(payload["keyword_flags"]);
    if (typeof payload["policy_text"] === "string") setPolicyText(payload["policy_text"]);
    if (payload["metadata"] && typeof payload["metadata"] === "object" && !Array.isArray(payload["metadata"])) {
      setMetadataJson(JSON.stringify(payload["metadata"], null, 2));
    }
    setDraftDialogOpen(true);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
      const response = await createPublisherSlot(ownerPubkey, {
        snippet_id: snippetId.trim() || undefined,
        page_url: pageUrl.trim(),
        dimensions: dimensions.trim(),
        min_amount_per_1000: minAmount.trim(),
        ad_position: Number(adPosition),
        publication_mode: Number(publicationMode),
        keyword_flags: keywordFlags.trim(),
        policy_text: policyText.trim() || null,
        metadata,
      });
      const nextSnippetId = response.slot.snippet_id;
      setCreatedSnippetId(nextSnippetId);
      setInstallArtifacts({
        loaderUrl: response.install.loader_url,
        embedHtml: response.install.embed_html,
        status: response.install.status,
      });
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
        <Link to="/publisher/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-accent/20 to-primary/20 border border-accent/30 flex items-center justify-center glow-purple">
          <LayoutTemplate className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Create Seller Slot</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Chat-first slot planning for an already-onboarded publisher. Confirmation appears only when the assistant has enough slot information.
          </p>
        </div>
      </div>

      {!ownerPubkey && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Missing `ownerPubkey` in the URL. Start from publisher onboarding so the new slot can be attached to a real publisher profile.
        </div>
      )}

      {ownerPubkey && (
        <AssistantThreadPanel
          title="Seller Slot Assistant"
          subtitle={`Publisher ${ownerPubkey} • Derive the slot payload here before submission.`}
          subjectType="seller_profile"
          subjectId={ownerPubkey}
          placeholder="Describe the page, placement position, dimensions, and pricing intent..."
          initialUserMessage="I want to create a new slot for this publisher."
          context={{
            wallet_owner_pubkey: walletState.identity,
            wallet_address: walletState.address,
            owner_pubkey: ownerPubkey,
          }}
          onAssistantReply={applyDraft}
        />
      )}

      {createdSnippetId && (
        <div className="glass rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold">Slot submitted</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Slot `{createdSnippetId}` is now stored and synchronized to the seller agent. Install the snippet on your page so the backend can detect it and trigger publication.
              </p>
            </div>
            <Link to={`/publisher/dashboard?ownerPubkey=${encodeURIComponent(ownerPubkey)}`}>
              <Button className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
                Open Inventory <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>

          {installArtifacts && (
            <div className="grid grid-cols-1 gap-4">
              <div className="rounded-xl border border-border/50 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Install Status
                </div>
                <div className="mt-1 text-sm font-medium">{installArtifacts.status}</div>
              </div>

              <label className="space-y-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Loader URL</span>
                <Textarea readOnly value={installArtifacts.loaderUrl} className="min-h-[84px]" />
              </label>

              <label className="space-y-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Embed HTML</span>
                <Textarea readOnly value={installArtifacts.embedHtml} className="min-h-[140px]" />
              </label>
            </div>
          )}
        </div>
      )}

      <Dialog open={draftDialogOpen} onOpenChange={setDraftDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Confirm Slot Payload</DialogTitle>
            <DialogDescription>
              Review the assistant-derived slot payload before submission.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Snippet ID (optional)</span>
              <Input value={snippetId} onChange={(event) => setSnippetId(event.target.value)} placeholder="snip_abc123" />
            </label>
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Page URL</span>
              <Input value={pageUrl} onChange={(event) => setPageUrl(event.target.value)} placeholder="https://publisher.example/article-1" />
            </label>
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Dimensions</span>
              <Input value={dimensions} onChange={(event) => setDimensions(event.target.value)} placeholder="728x90" />
            </label>
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Min amount per 1000</span>
              <Input value={minAmount} onChange={(event) => setMinAmount(event.target.value)} placeholder="1200" />
            </label>
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Ad position</span>
              <Input value={adPosition} onChange={(event) => setAdPosition(event.target.value)} placeholder="0" />
            </label>
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Publication mode</span>
              <Input value={publicationMode} onChange={(event) => setPublicationMode(event.target.value)} placeholder="1" />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Keyword flags</span>
              <Input value={keywordFlags} onChange={(event) => setKeywordFlags(event.target.value)} placeholder="0" />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Policy text</span>
              <Textarea value={policyText} onChange={(event) => setPolicyText(event.target.value)} placeholder="No gambling or explicit content..." />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Metadata JSON</span>
              <Textarea value={metadataJson} onChange={(event) => setMetadataJson(event.target.value)} placeholder='{"category":"header"}' />
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
              disabled={!canSubmit || isSubmitting}
              className="gap-2 bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {isSubmitting ? "Submitting..." : "Confirm & Submit Slot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
