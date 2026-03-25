import { useState } from "react";
import { Link } from "react-router-dom";
import { Globe, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createPublisherProfile, type SellerProfile } from "@/lib/api";
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

export default function PublisherOnboard() {
  const walletState = useWalletIdentity();
  const [ownerPubkey, setOwnerPubkey] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [blockId, setBlockId] = useState("");
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftDialogOpen, setDraftDialogOpen] = useState(false);
  const resolvedOwnerPubkey = walletState.identity ?? ownerPubkey;

  const applyDraft = (draft: AssistantDraftEnvelope | null) => {
    if (!draft || draft.draft_type !== "seller_profile_init") return;
    const payload = draft.payload;
    if (typeof payload["owner_pubkey"] === "string") setOwnerPubkey(payload["owner_pubkey"]);
    if (typeof payload["site_url"] === "string") setSiteUrl(payload["site_url"]);
    if (typeof payload["block_id"] === "string") setBlockId(payload["block_id"]);
    setDraftDialogOpen(true);
  };

  const submit = async () => {
    if (!resolvedOwnerPubkey.trim() || !siteUrl.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const created = await createPublisherProfile({
        owner_pubkey: resolvedOwnerPubkey.trim(),
        site_url: siteUrl.trim(),
        block_id: blockId.trim() || null,
      });
      setProfile(created);
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
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-accent/20 to-primary/20 border border-accent/30 flex items-center justify-center glow-purple">
          <Globe className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Publisher Onboarding</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Chat-first onboarding for publisher profile creation. Slot creation is a separate flow for already-onboarded publishers.
          </p>
        </div>
      </div>

      {!profile && (
        <AssistantThreadPanel
          title="Publisher Onboarding Assistant"
          subtitle="New publisher flow • The assistant gathers the minimal seller profile payload."
          subjectType="seller_profile"
          subjectId={null}
          placeholder="Tell me about the publisher site you want to onboard..."
          initialAssistantMessage="Let’s onboard a publisher profile. If your wallet is connected, I already have your owner public key. Tell me the site URL you want to onboard, and I’ll guide the rest."
          context={{
            wallet_owner_pubkey: walletState.identity,
            wallet_address: walletState.address,
          }}
          onAssistantReply={applyDraft}
        />
      )}

      {profile && (
        <div className="glass rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">Publisher profile created</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Publisher `{profile.owner_pubkey}` is now registered. Next, move to slot creation for the first seller-managed slot.
            </p>
          </div>
          <Link to={`/publisher/new-placement?ownerPubkey=${encodeURIComponent(profile.owner_pubkey)}`}>
            <Button className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
              Create First Slot <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      )}

      <Dialog open={draftDialogOpen} onOpenChange={setDraftDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Confirm Publisher Profile</DialogTitle>
            <DialogDescription>
              Review the assistant-derived publisher payload before creation.
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
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Site URL</span>
              <Input value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)} placeholder="https://publisher.example" />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Preferred block ID (optional)</span>
              <Input value={blockId} onChange={(event) => setBlockId(event.target.value)} placeholder="default" />
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
              disabled={!resolvedOwnerPubkey.trim() || !siteUrl.trim() || isSubmitting}
              className="gap-2 bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {isSubmitting ? "Creating..." : "Confirm & Create Publisher"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
