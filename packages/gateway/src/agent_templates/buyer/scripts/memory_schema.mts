import { z } from "zod";

const UnknownRecordSchema = z.record(z.string(), z.unknown());

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
    discovery: UnknownRecordSchema.optional(),
    slot_details: UnknownRecordSchema.optional(),
    conversation: UnknownRecordSchema.optional(),
    negotiation: UnknownRecordSchema.optional(),
    delivery: UnknownRecordSchema.optional(),
    verification: UnknownRecordSchema.optional(),
    payment_channel: UnknownRecordSchema.optional(),
    payments: UnknownRecordSchema.optional(),
    tasks: UnknownRecordSchema.optional(),
    task_ids: UnknownRecordSchema.optional(),
    manual_submission_deadline: z.unknown().optional(),
  })
  .passthrough();

export const BuyerPlacementsFileSchema = z.array(BuyerPlacementSchema);

export const BuyerStatsSchema = z
  .object({
    last_report_date: z.string().nullable(),
    total_spend_udt: z.string(),
    total_impressions: z.number(),
    active_placement_count: z.number(),
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

export type BuyerPlacement = z.infer<typeof BuyerPlacementSchema>;
export type ConversationLog = z.infer<typeof ConversationLogSchema>;
