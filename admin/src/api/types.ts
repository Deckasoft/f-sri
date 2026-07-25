import { z } from 'zod';

// Mirrors src/models/IssuingCompany.ts's JSON shape (Mongoose serializes
// ObjectId -> hex string and Date -> ISO string via res.json).
export const tenantSchema = z.object({
  _id: z.string(),
  ruc: z.string(),
  razon_social: z.string(),
  nombre_comercial: z.string(),
  direccion: z.string().optional(),
  direccion_matriz: z.string().optional(),
  direccion_establecimiento: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().optional(),
  codigo_establecimiento: z.string(),
  punto_emision: z.string(),
  tipo_ambiente: z.union([z.literal(1), z.literal(2)]),
  tipo_emision: z.literal(1),
  obligado_contabilidad: z.boolean().optional(),
  contribuyente_especial: z.string().optional(),
  email_notificacion: z.string().optional(),
  active: z.boolean(),
  onboarded_at: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Tenant = z.infer<typeof tenantSchema>;

// Mirrors src/routes/admin/tenant.ts's createTenantSchema, minus server-only
// fields (created_by is derived from the admin JWT).
export const newTenantSchema = z.object({
  ruc: z.string().regex(/^\d{10}001$/, 'RUC inválido: debe tener 13 dígitos y terminar en 001'),
  razon_social: z.string().min(1, 'Requerido'),
  nombre_comercial: z.string().min(1, 'Requerido'),
});
export type NewTenantInput = z.infer<typeof newTenantSchema>;

// Mirrors src/routes/admin/tenant.ts's updateTenantSchema (tenantProfileSchema.partial()).
export const tenantProfileSchema = z.object({
  razon_social: z.string().min(1),
  nombre_comercial: z.string().min(1),
  direccion: z.string().optional(),
  direccion_matriz: z.string().optional(),
  direccion_establecimiento: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  codigo_establecimiento: z.string().optional(),
  punto_emision: z.string().optional(),
  tipo_ambiente: z.union([z.literal(1), z.literal(2)]).optional(),
  obligado_contabilidad: z.boolean().optional(),
  contribuyente_especial: z.string().optional(),
  email_notificacion: z.string().email().optional().or(z.literal('')),
});
export type TenantProfileInput = z.infer<typeof tenantProfileSchema>;

// Mirrors src/routes/admin/apiKey.ts's GET / response (key_hash excluded via .select('-key_hash')).
export const apiKeySchema = z.object({
  _id: z.string(),
  empresa_emisora_id: z.string(),
  name: z.string(),
  prefix: z.string(),
  last_used_at: z.string().nullable().optional(),
  revoked_at: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});
export type ApiKeyItem = z.infer<typeof apiKeySchema>;

// Mirrors src/routes/admin/apiKey.ts's POST / response — the ONLY place the
// raw token is ever returned.
export const apiKeyCreatedSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  token: z.string(),
  created_at: z.string().optional(),
});
export type ApiKeyCreated = z.infer<typeof apiKeyCreatedSchema>;

// Mirrors src/routes/admin/invite.ts's GET / response (token_hash never serialized).
export const inviteSchema = z.object({
  _id: z.string(),
  empresa_emisora_id: z.string(),
  expires_at: z.string(),
  used_at: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});
export type InviteItem = z.infer<typeof inviteSchema>;

// Mirrors src/routes/admin/invite.ts's POST / response — the ONLY place the
// raw token + onboarding URL are ever returned.
export const inviteCreatedSchema = z.object({
  id: z.string(),
  token: z.string(),
  onboarding_url: z.string(),
  expires_at: z.string(),
});
export type InviteCreated = z.infer<typeof inviteCreatedSchema>;

// Mirrors src/routes/admin/usage.ts's GET /tenants/:id/usage response.
export const usageRowSchema = z.object({
  document_type: z.string(),
  sri_estado: z.string(),
  count: z.number(),
});
export type UsageRow = z.infer<typeof usageRowSchema>;

// Mirrors src/routes/admin/usage.ts's GET /usage/summary response.
export const usageSummaryRowSchema = z.object({
  empresa_emisora_id: z.string(),
  total: z.number(),
});
export type UsageSummaryRow = z.infer<typeof usageSummaryRowSchema>;

// Mirrors src/routes/admin/auth.ts's POST /login response.
export const loginResponseSchema = z.object({
  token: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
    role: z.string(),
  }),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

// Mirrors src/routes/onboarding.ts's GET /invite/:token response.
export const invitePreviewSchema = z.discriminatedUnion('valid', [
  z.object({
    valid: z.literal(true),
    company: z.object({
      razon_social: z.string(),
      nombre_comercial: z.string(),
      ruc: z.string(),
    }),
  }),
  z.object({
    valid: z.literal(false),
    reason: z.string(),
  }),
]);
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

// Mirrors src/routes/onboarding.ts's POST /complete response — the ONLY
// place the tenant's first API key raw token is ever returned.
export const onboardingCompleteResponseSchema = z.object({
  message: z.string(),
  api_key: z.string(),
  company: z.object({
    id: z.string(),
    razon_social: z.string(),
    nombre_comercial: z.string(),
    ruc: z.string(),
  }),
});
export type OnboardingCompleteResponse = z.infer<typeof onboardingCompleteResponseSchema>;
