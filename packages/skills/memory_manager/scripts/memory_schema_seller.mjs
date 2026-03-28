import { z } from "zod";

const UnknownRecordSchema = z.record(z.string(), z.unknown());

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
    slot_details: UnknownRecordSchema.optional(),
    publication: UnknownRecordSchema.optional(),
    correlation_map: z.record(z.string(), z.string()).optional(),
    current_booking: z.union([UnknownRecordSchema, z.null()]).optional(),
    history: z.array(z.unknown()).optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

export const SellerSlotsFileSchema = z.array(SellerSlotSchema);

export const SellerStatsSchema = z
  .object({
    last_report_date: z.string().nullable(),
    total_revenue_udt: z.string(),
    total_impressions_served: z.number(),
    slots_total: z.number(),
    slots_active: z.number(),
  })
  .passthrough();

export const ConversationLogSchema = z
  .object({
    contextId: z.string(),
    startedAt: z.string().nullable().optional(),
    endedAt: z.string().nullable().optional(),
    status: z.string(),
    summary: z.unknown().nullable().optional(),
    messages: z.array(z.unknown()),
    updatedAt: z.string().optional(),
  })
  .passthrough();

export type SellerSlot = z.infer<typeof SellerSlotSchema>;

