import crypto from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { readRecord, writeRecord } from "../../store.js";
import type {
  SnippetContentPayload,
  SnippetCreateInput,
  SnippetLoaderView,
  SnippetRecord,
  SnippetRouteView,
  SnippetService,
  SnippetSignerPolicy,
} from "../types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function makeSnippetId(): string {
  return `snip_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${canonicalize(val)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashSnippetContentPayload(payload: SnippetContentPayload): string {
  return crypto
    .createHash("sha256")
    .update(canonicalize(payload))
    .digest("hex");
}

function verifySnippetContentSignature(
  contentHashHex: string,
  signatureHex: string,
  signerPubkeyHex: string,
): boolean {
  const messageBytes = Buffer.from(contentHashHex.replace(/^0x/, ""), "hex");
  const signatureBytes = Buffer.from(signatureHex.replace(/^0x/, ""), "hex");
  const pubkeyBytes = Buffer.from(signerPubkeyHex.replace(/^0x/, ""), "hex");
  if (messageBytes.length !== 32) return false;
  if (signatureBytes.length !== 65) return false;
  if (pubkeyBytes.length !== 33) return false;
  try {
    return secp256k1.verify(
      signatureBytes.subarray(0, 64),
      messageBytes,
      pubkeyBytes,
      { prehash: false },
    );
  } catch {
    return false;
  }
}

function parseDimensions(value: string | null | undefined): {
  widthPx: number | null;
  heightPx: number | null;
} {
  if (!value) return { widthPx: null, heightPx: null };
  const match = value.trim().match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return { widthPx: null, heightPx: null };
  return { widthPx: Number(match[1]), heightPx: Number(match[2]) };
}

function defaultSnippet(snippetId: string): SnippetRecord {
  return {
    snippet_id: snippetId,
    owner_pubkey: null,
    signer_policy: "owner",
    dimensions: null,
    version: 0,
    status: "inactive",
    image_url: null,
    destination_url: null,
    writeup: null,
    created_at: "",
    updated_at: "",
  };
}

function normalizeSnippet(
  snippetId: string,
  snippet: SnippetRecord | null,
): SnippetRecord {
  if (!snippet) return defaultSnippet(snippetId);
  return {
    ...defaultSnippet(snippetId),
    ...snippet,
    destination_url: snippet.destination_url ?? null,
    writeup: snippet.writeup ?? null,
  };
}

function readSignerPubkeyForPolicy(
  policy: SnippetSignerPolicy,
  ownerPubkey: string | null,
): string {
  if (!ownerPubkey) throw new Error("owner pubkey missing for snippet signer policy");
  if (policy === "owner") return ownerPubkey;
  const seller = readRecord<{ agent_pubkey: string | null }>(
    "seller_profiles",
    ownerPubkey,
  );
  const agentPubkey = seller?.agent_pubkey ?? null;
  if (!agentPubkey) {
    throw new Error("publisher does not have an active seller agent pubkey");
  }
  return agentPubkey;
}

export function createSnippetService(
  deps: {
    booking: {
      buildSnippetImpressionTrackingUrl: (snippetId: string) => string;
      buildSnippetClickTrackingUrl: (snippetId: string) => string;
      buildLoaderUrl: (snippetId: string) => string;
      buildEmbedHtml: (snippetId: string) => string;
    };
  },
): SnippetService {
  return {
    createStandalone(input: SnippetCreateInput): SnippetRecord {
      const snippetId = makeSnippetId();
      const now = nowIso();
      const policy: SnippetSignerPolicy = input.signer_policy ?? "owner";
      const snippet: SnippetRecord = {
        snippet_id: snippetId,
        owner_pubkey: input.owner_pubkey ?? null,
        signer_policy: policy,
        dimensions: input.dimensions ?? null,
        version: 0,
        status: "inactive",
        image_url: null,
        destination_url: null,
        writeup: null,
        created_at: now,
        updated_at: now,
      };
      writeRecord("snippets", snippetId, snippet);
      return snippet;
    },
    readSnippet(snippetId: string): SnippetRecord | null {
      const snippet = readRecord<SnippetRecord>("snippets", snippetId);
      return snippet ? normalizeSnippet(snippetId, snippet) : null;
    },
    activateOnImpression(snippetId: string): SnippetRecord | null {
      const current = this.readSnippet(snippetId);
      if (!current) return null;
      if (current.status === "active") return current;
      const updated: SnippetRecord = {
        ...current,
        status: "active",
        updated_at: nowIso(),
      };
      writeRecord("snippets", snippetId, updated);
      return updated;
    },
    updateSnippetMetadata(snippetId, updates): SnippetRecord {
      const current = this.readSnippet(snippetId);
      if (!current) throw new Error("snippet not found");
      const updated: SnippetRecord = normalizeSnippet(snippetId, {
        ...current,
        dimensions: updates.dimensions === undefined ? current.dimensions : updates.dimensions,
        updated_at: nowIso(),
      });
      writeRecord("snippets", snippetId, updated);
      return updated;
    },
    getRouteView(snippetId: string): SnippetRouteView | null {
      const snippet = this.readSnippet(snippetId);
      if (!snippet) return null;
      return {
        snippet,
        seller_impression_tracking_url:
          deps.booking.buildSnippetImpressionTrackingUrl(snippet.snippet_id),
        seller_click_tracking_url:
          deps.booking.buildSnippetClickTrackingUrl(snippet.snippet_id),
        loader_url: deps.booking.buildLoaderUrl(snippet.snippet_id),
        embed_html: deps.booking.buildEmbedHtml(snippet.snippet_id),
      };
    },
    getLoaderView(snippetId: string): SnippetLoaderView | null {
      const snippet = this.readSnippet(snippetId);
      if (!snippet) return null;
      const dimensions = parseDimensions(snippet.dimensions);
      return {
        snippetId: snippet.snippet_id,
        status: snippet.status,
        imageUrl: snippet.image_url,
        actionUrl: snippet.destination_url,
        writeUp: snippet.writeup,
        widthPx: dimensions.widthPx,
        heightPx: dimensions.heightPx,
        sellerImpressionTrackingUrl:
          deps.booking.buildSnippetImpressionTrackingUrl(snippet.snippet_id),
        sellerClickTrackingUrl:
          deps.booking.buildSnippetClickTrackingUrl(snippet.snippet_id),
      };
    },
    updateSignedContent(
      payload: SnippetContentPayload,
      signatureHex: string,
    ): SnippetRecord {
      if (!payload.snippet_id) throw new Error("snippet_id is required");
      if (!signatureHex) throw new Error("signature is required");
      if (!Number.isInteger(payload.version) || payload.version < 1) {
        throw new Error("version must be an integer >= 1");
      }
      const snippet = readRecord<SnippetRecord>("snippets", payload.snippet_id);
      if (!snippet) throw new Error("snippet not found");
      const ownerPubkey = snippet.owner_pubkey ?? null;
      const signerPolicy = snippet.signer_policy ?? "owner";
      const signerPubkey = readSignerPubkeyForPolicy(signerPolicy, ownerPubkey);

      if (payload.version <= snippet.version) {
        throw new Error("snippet content version must increase monotonically");
      }
      const hash = hashSnippetContentPayload(payload);
      if (!verifySnippetContentSignature(hash, signatureHex, signerPubkey)) {
        throw new Error("invalid snippet content signature");
      }

      const record: SnippetRecord = {
        ...snippet,
        version: payload.version,
        image_url: payload.image_url,
        destination_url: payload.destination_url,
        writeup: payload.writeup,
        updated_at: nowIso(),
      };
      writeRecord("snippets", payload.snippet_id, record);
      return record;
    },
  };
}

