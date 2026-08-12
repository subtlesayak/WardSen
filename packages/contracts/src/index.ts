import { z } from "zod";

export const deliveryStatusValueSchema = z.enum([
  "creating",
  "handoff_pending",
  "active",
  "viewed",
  "limit_reached",
  "expired",
  "revoked",
  "failed"
]);

export const deliveryMethodSchema = z.enum(["copy", "whatsapp", "email"]);

export const deliveryPolicySnapshotSchema = z.object({
  sourceProviderId: z.string().min(1),
  sourceAccountId: z.string().min(1),
  sourceItemId: z.string().min(1),
  deliveryProviderId: z.string().min(1),
  deliveryAccountId: z.string().min(1),
  recipientId: z.string().min(1).optional(),
  deliveryMethod: deliveryMethodSchema.optional(),
  expiresAt: z.string().min(1),
  viewLimit: z.number().int().positive().optional(),
  viewOnce: z.boolean(),
  accessSecretRequired: z.boolean(),
  hideText: z.boolean()
});

export const deliveryRecordSchema = z.object({
  id: z.string().min(1),
  operationId: z.string().min(1).optional(),
  operationFingerprint: z.string().min(1).optional(),
  policySnapshot: deliveryPolicySnapshotSchema.optional(),
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
  firstViewedAt: z.string().min(1).optional(),
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

export const deliveryListSchema = z.object({
  items: z.array(deliveryRecordSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative()
});

export const batchDeliveryRevokeResultSchema = z.object({
  batchId: z.string().min(1),
  revokedCount: z.number().int().nonnegative(),
  inactiveCount: z.number().int().nonnegative(),
  failed: z.array(z.object({
    deliveryId: z.string().min(1),
    error: z.string().min(1)
  }))
});

export const terminalSessionHandoffResponseSchema = z.object({
  command: z.string().min(1),
  expiresAt: z.string().datetime()
});

export const employeeRecordSchema = z.object({
  id: z.string().min(1),
  personId: z.string().min(1).optional(),
  name: z.string().min(1),
  assignedEmail: z.string().email(),
  team: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  active: z.boolean()
});

export const credentialRiskTierSchema = z.enum(["low", "medium", "high", "critical"]);

export const catalogAutoApprovalPolicySchema = z.object({
  maxRiskTier: credentialRiskTierSchema,
  maxExpectedDurationMinutes: z.number().int().positive().optional(),
  requireTicketRef: z.boolean()
});

export const credentialCatalogEntrySchema = z.object({
  id: z.string().min(1),
  sourceProviderId: z.string().min(1),
  sourceAccountId: z.string().min(1),
  sourceItemId: z.string().min(1),
  credentialName: z.string().min(1),
  username: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)),
  riskTier: credentialRiskTierSchema,
  allowedEmployeeIds: z.array(z.string().min(1)),
  allowedTeams: z.array(z.string().min(1)),
  allowedRoles: z.array(z.string().min(1)),
  active: z.boolean(),
  autoApprovalPolicy: catalogAutoApprovalPolicySchema.optional()
});

export const credentialAccessRequestStatusSchema = z.enum(["pending", "approved", "break_glass", "denied", "fulfilled", "cancelled"]);

export const credentialAccessRequestRecordSchema = z.object({
  id: z.string().min(1),
  employeeId: z.string().min(1),
  assignedEmail: z.string().email(),
  catalogEntryId: z.string().min(1),
  credentialName: z.string().min(1),
  reason: z.string().min(1),
  ticketRef: z.string().min(1).optional(),
  expectedDurationMinutes: z.number().int().positive().optional(),
  breakGlass: z.boolean(),
  breakGlassJustification: z.string().min(1).optional(),
  breakGlassConfirmedAt: z.string().min(1).optional(),
  status: credentialAccessRequestStatusSchema,
  requestedAt: z.string().min(1),
  approver: z.string().min(1).optional(),
  decisionReason: z.string().min(1).optional(),
  deliveryId: z.string().min(1).optional(),
  deliveryProviderId: z.string().min(1).optional(),
  deliveryAccountId: z.string().min(1).optional(),
  previousDeliveryId: z.string().min(1).optional(),
  replacementCount: z.number().int().nonnegative().optional(),
  lastReplacementAt: z.string().min(1).optional()
});

export const employeePortalSessionSchema = z.object({
  sessionToken: z.string().min(1),
  expiresAt: z.string().min(1),
  employee: employeeRecordSchema
});

export const employeeSignInCodeResponseSchema = z.object({
  employeeId: z.string().min(1),
  assignedEmail: z.string().email(),
  code: z.string().min(1),
  expiresAt: z.string().min(1),
  delivery: z.enum(["manual", "email_draft"]),
  emailDraft: z.object({
    senderEmail: z.string().email(),
    to: z.string().email(),
    subject: z.string().min(1),
    body: z.string().min(1)
  }).optional()
});

export const employeeListSchema = z.object({ items: z.array(employeeRecordSchema) });
export const credentialCatalogListSchema = z.object({ items: z.array(credentialCatalogEntrySchema) });
export const credentialAccessRequestListSchema = z.object({ items: z.array(credentialAccessRequestRecordSchema) });
export const credentialAccessRequestCreateResponseSchema = z.union([
  credentialAccessRequestRecordSchema,
  z.object({
    request: credentialAccessRequestRecordSchema,
    delivery: createdDeliveryRecordSchema.optional(),
    autoApproved: z.boolean().optional()
  })
]);

export const deliveryAccessConfidenceSchema = z.enum(["provider_verified", "recipient_link", "self_reported", "unknown"]);
export const deliveryAccessEventSchema = z.object({
  deliveryId: z.string().min(1),
  recipientId: z.string().min(1).optional(),
  observedAt: z.string().min(1),
  accessCount: z.number().int().nonnegative(),
  providerUserId: z.string().min(1).optional(),
  providerEmail: z.string().email().optional(),
  ipAddress: z.string().min(1).optional(),
  userAgent: z.string().min(1).optional(),
  deviceLabel: z.string().min(1).optional(),
  source: z.enum(["provider", "wardsen_gateway"]),
  confidence: deliveryAccessConfidenceSchema
}).superRefine((event, context) => {
  if (event.confidence === "provider_verified") return;
  for (const field of ["providerUserId", "providerEmail", "ipAddress", "userAgent", "deviceLabel"] as const) {
    if (event[field] !== undefined) {
      context.addIssue({ code: "custom", path: [field], message: "Identity metadata requires provider-verified confidence." });
    }
  }
});

export type DeliveryRecordContract = z.infer<typeof deliveryRecordSchema>;
export type CreatedDeliveryRecordContract = z.infer<typeof createdDeliveryRecordSchema>;
export type BulkDeliveryItemResultContract = z.infer<typeof bulkDeliveryItemResultSchema>;
export type BulkDeliveryResultContract = z.infer<typeof bulkDeliveryResultSchema>;
export type DeliveryListContract = z.infer<typeof deliveryListSchema>;
export type BatchDeliveryRevokeResultContract = z.infer<typeof batchDeliveryRevokeResultSchema>;
export type TerminalSessionHandoffResponseContract = z.infer<typeof terminalSessionHandoffResponseSchema>;
export type EmployeeRecordContract = z.infer<typeof employeeRecordSchema>;
export type CredentialCatalogEntryContract = z.infer<typeof credentialCatalogEntrySchema>;
export type CredentialAccessRequestRecordContract = z.infer<typeof credentialAccessRequestRecordSchema>;
export type EmployeePortalSessionContract = z.infer<typeof employeePortalSessionSchema>;
export type EmployeeSignInCodeResponseContract = z.infer<typeof employeeSignInCodeResponseSchema>;
export type CredentialAccessRequestCreateResponseContract = z.infer<typeof credentialAccessRequestCreateResponseSchema>;
export type DeliveryAccessEventContract = z.infer<typeof deliveryAccessEventSchema>;

export function parseCreatedDeliveryRecord(value: unknown): CreatedDeliveryRecordContract {
  return createdDeliveryRecordSchema.parse(value);
}

export function parseDeliveryRecord(value: unknown): DeliveryRecordContract {
  return deliveryRecordSchema.parse(value);
}

export function parseBulkDeliveryResult(value: unknown): BulkDeliveryResultContract {
  return bulkDeliveryResultSchema.parse(value);
}

export function parseDeliveryList(value: unknown): DeliveryListContract {
  return deliveryListSchema.parse(value);
}

export function parseBatchDeliveryRevokeResult(value: unknown): BatchDeliveryRevokeResultContract {
  return batchDeliveryRevokeResultSchema.parse(value);
}

export function parseTerminalSessionHandoffResponse(value: unknown): TerminalSessionHandoffResponseContract {
  return terminalSessionHandoffResponseSchema.parse(value);
}

export function parseEmployeeList(value: unknown) {
  return employeeListSchema.parse(value);
}

export function parseCredentialCatalogList(value: unknown) {
  return credentialCatalogListSchema.parse(value);
}

export function parseCredentialAccessRequestList(value: unknown) {
  return credentialAccessRequestListSchema.parse(value);
}

export function parseEmployeePortalSession(value: unknown): EmployeePortalSessionContract {
  return employeePortalSessionSchema.parse(value);
}

export function parseEmployeeSignInCodeResponse(value: unknown): EmployeeSignInCodeResponseContract {
  return employeeSignInCodeResponseSchema.parse(value);
}

export function parseCredentialAccessRequestCreateResponse(value: unknown): CredentialAccessRequestCreateResponseContract {
  return credentialAccessRequestCreateResponseSchema.parse(value);
}

export function parseDeliveryAccessEvent(value: unknown): DeliveryAccessEventContract {
  return deliveryAccessEventSchema.parse(value);
}
