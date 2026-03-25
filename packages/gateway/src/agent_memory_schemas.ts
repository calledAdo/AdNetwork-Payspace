import { z } from "zod";

const UnknownObjectSchema = z.record(z.string(), z.unknown());

export const InitConfigSchema = UnknownObjectSchema;
export const StatsSchema = UnknownObjectSchema;

export const BuyerPlacementStateSchema = z.enum([
  "negotiating",
  "awaiting_publication",
  "verifying",
  "channel_open",
  "streaming",
  "closing",
  "closed",
  "disputed",
]);

export const BuyerPlacementSchema = z
  .object({
    placement_id: z.string(),
    state: BuyerPlacementStateSchema.optional(),
    discovery: UnknownObjectSchema.optional(),
    slot_details: UnknownObjectSchema.optional(),
    conversation: UnknownObjectSchema.optional(),
    negotiation: UnknownObjectSchema.optional(),
    delivery: UnknownObjectSchema.optional(),
    verification: UnknownObjectSchema.optional(),
    payment_channel: UnknownObjectSchema.optional(),
    payments: UnknownObjectSchema.optional(),
    tasks: UnknownObjectSchema.optional(),
    task_ids: UnknownObjectSchema.optional(),
  })
  .passthrough();

export const BuyerPlacementsFileSchema = z.array(BuyerPlacementSchema);

export const SellerSlotStateSchema = z.enum([
  "awaiting_install",
  "publishing",
  "available",
  "negotiating",
  "streaming",
  "closing",
  "disputed",
]);

export const SellerSlotSchema = z
  .object({
    snippet_id: z.string(),
    state: SellerSlotStateSchema,
    slot_details: UnknownObjectSchema.optional(),
    publication: UnknownObjectSchema.optional(),
    current_booking: UnknownObjectSchema.optional(),
    correlation_map: z.record(z.string(), z.string()).optional(),
    history: z.array(z.unknown()).optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

export const SellerSlotsFileSchema = z.array(SellerSlotSchema);

export const ConversationMessageSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  UnknownObjectSchema,
]);

export const ConversationLogSchema = z
  .object({
    contextId: z.string(),
    startedAt: z.string().nullable().optional(),
    endedAt: z.string().nullable().optional(),
    status: z.string().optional(),
    messages: z.array(ConversationMessageSchema).default([]),
    summary: z.unknown().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();

export type BuyerPlacement = z.infer<typeof BuyerPlacementSchema>;
export type SellerSlot = z.infer<typeof SellerSlotSchema>;
export type ConversationLog = z.infer<typeof ConversationLogSchema>;
