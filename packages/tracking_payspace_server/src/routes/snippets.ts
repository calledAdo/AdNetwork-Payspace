import { Router, type Request, type Response } from "express";
import { getPluginRegistry } from "../plugins/registry.js";
import type { SnippetSignerPolicy } from "../plugins/types.js";

const router = Router();
const plugins = getPluginRegistry();

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asSignerPolicy(value: unknown): SnippetSignerPolicy | null {
  return value === "owner" || value === "seller_agent" ? value : null;
}

router.post("/", (req: Request, res: Response) => {
  const snippet = plugins.snippet.createStandalone({
    owner_pubkey: asString(req.body?.owner_pubkey),
    signer_policy: asSignerPolicy(req.body?.signer_policy) ?? "owner",
    dimensions: asString(req.body?.dimensions),
  });

  res.status(201).json({
    snippet_id: snippet.snippet_id,
    owner_pubkey: snippet.owner_pubkey,
    signer_policy: snippet.signer_policy,
    dimensions: snippet.dimensions,
    status: snippet.status,
    loader_url: plugins.booking.buildLoaderUrl(snippet.snippet_id),
    embed_html: plugins.booking.buildEmbedHtml(snippet.snippet_id),
    created_at: snippet.created_at,
  });
});

router.get("/:id", (req: Request, res: Response) => {
  const snippetId = String(req.params.id);
  const view = plugins.snippet.getRouteView(snippetId);
  if (!view) {
    const snippet = plugins.snippet.readSnippet(snippetId);
    if (!snippet || (snippet.version === 0 && !snippet.updated_at)) {
      res.status(404).json({ error: "snippet not found" });
      return;
    }
    res.json({
      snippet_id: snippetId,
      snippet,
      loader_url: plugins.booking.buildLoaderUrl(snippetId),
      embed_html: plugins.booking.buildEmbedHtml(snippetId),
    });
    return;
  }
  res.json({
    snippet_id: snippetId,
    ...view,
  });
});

router.post("/:id/content", (req: Request, res: Response) => {
  const snippetId = String(req.params.id);
  const signature = asString(req.body?.signature) ?? "";
  if (!signature) {
    res.status(400).json({ error: "signature is required" });
    return;
  }
  try {
    if (req.body?.dimensions !== undefined) {
      plugins.snippet.updateSnippetMetadata(snippetId, {
        dimensions: req.body?.dimensions === undefined ? undefined : asString(req.body?.dimensions),
      });
    }
    const updated = plugins.snippet.updateSignedContent(
      {
        snippet_id: snippetId,
        version: Number(req.body?.version ?? 0),
        image_url: asString(req.body?.image_url),
        destination_url: asString(req.body?.destination_url),
        writeup: asString(req.body?.writeup),
      },
      signature,
    );
    res.json({
      updated: true,
      snippet_id: updated.snippet_id,
      version: updated.version,
      status: updated.status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: message });
  }
});

export default router;

