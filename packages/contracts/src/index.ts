import { z } from "zod";

export const deliveryStatusValueSchema = z.enum([
  "creating",
  "active",
  "viewed",
  "limit_reached",
  "expired",
  "revoked",
  "failed"
]);

export const deliveryMethodSchema = z.enum(["copy", "whatsapp", "email"]);

export const deliveryRecordSchema = z.object({
  id: z.string().min(1),
  providerDeliveryId: z.string().min(1).optional(),
  credentialName: z.string().min(1),
  personId: z.string().min(1).optional(),
  sourceProviderId: z.string().min(1),
  sourceAccountId: z.string().min(1),
  deliveryProviderId: z.string().min(1),
  deliveryAccountId: z.string().min(1),
  batchId: z.string().min(1).optional(),
  deliveryMethod: deliveryMethodSchema.optional(),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
  viewLimit: z.number().int().positive().optional(),
  accessCount: z.number().int().nonnegative().optional(),
  status: deliveryStatusValueSchema.or(z.string().min(1)),
  revokedAt: z.string().min(1).optional(),
  lastCheckedAt: z.string().min(1).optional()
});

export const createdDeliveryRecordSchema = deliveryRecordSchema.extend({
  oneTimeDeliveryUrl: z.string().url()
});

export const bulkDeliveryItemResultSchema = z.object({
  recipientId: z.string().min(1).optional(),
  ok: z.boolean(),
  delivery: createdDeliveryRecordSchema.optional(),
  error: z.string().min(1).optional()
});

export const bulkDeliveryResultSchema = z.object({
  batchId: z.string().min(1),
  requestedCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  results: z.array(bulkDeliveryItemResultSchema)
});

export type DeliveryRecordContract = z.infer<typeof deliveryRecordSchema>;
export type CreatedDeliveryRecordContract = z.infer<typeof createdDeliveryRecordSchema>;
export type BulkDeliveryItemResultContract = z.infer<typeof bulkDeliveryItemResultSchema>;
export type BulkDeliveryResultContract = z.infer<typeof bulkDeliveryResultSchema>;

export function parseCreatedDeliveryRecord(value: unknown): CreatedDeliveryRecordContract {
  return createdDeliveryRecordSchema.parse(value);
}

export function parseBulkDeliveryResult(value: unknown): BulkDeliveryResultContract {
  return bulkDeliveryResultSchema.parse(value);
}
