import { createBookingService } from "./default/booking.js";
import { createSnippetService } from "./default/snippet.js";
import type { PluginRegistry } from "./types.js";

let singleton: PluginRegistry | null = null;

export function createDefaultPluginRegistry(): PluginRegistry {
  const booking = createBookingService({
    readSnippetExists: (snippetId) => !!singleton?.snippet.readSnippet(snippetId),
  });
  const snippet = createSnippetService({
    booking,
  });
  return { snippet, booking };
}

export function getPluginRegistry(): PluginRegistry {
  if (!singleton) {
    singleton = createDefaultPluginRegistry();
  }
  return singleton;
}

