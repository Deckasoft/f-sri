import { z } from 'zod';
import { apiRequest, withBearerToken } from './client';
import {
  apiKeyCreatedSchema,
  apiKeySchema,
  inviteCreatedSchema,
  inviteSchema,
  loginResponseSchema,
  sequenceSeedResultSchema,
  tenantSchema,
  tenantSequencesSchema,
  usageRowSchema,
  usageSummaryRowSchema,
  type ApiKeyCreated,
  type ApiKeyItem,
  type InviteCreated,
  type InviteItem,
  type LoginResponse,
  type NewTenantInput,
  type SequenceSeedResult,
  type Tenant,
  type TenantProfileInput,
  type TenantSequences,
  type UsageRow,
  type UsageSummaryRow,
} from './types';

const okMessageSchema = z.object({ message: z.string() });

export const login = (email: string, password: string): Promise<LoginResponse> =>
  apiRequest('/admin/api/auth/login', loginResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

export const listTenants = (token: string): Promise<Tenant[]> =>
  apiRequest('/admin/api/tenants', z.array(tenantSchema), { headers: withBearerToken(token) });

export const getTenant = (token: string, tenantId: string): Promise<Tenant> =>
  apiRequest(`/admin/api/tenants/${tenantId}`, tenantSchema, { headers: withBearerToken(token) });

export const createTenant = (token: string, data: NewTenantInput): Promise<Tenant> =>
  apiRequest('/admin/api/tenants', tenantSchema, {
    method: 'POST',
    headers: withBearerToken(token),
    body: JSON.stringify(data),
  });

export const updateTenant = (
  token: string,
  tenantId: string,
  data: TenantProfileInput,
): Promise<Tenant> =>
  apiRequest(`/admin/api/tenants/${tenantId}`, tenantSchema, {
    method: 'PUT',
    headers: withBearerToken(token),
    body: JSON.stringify(data),
  });

export const setTenantActive = (
  token: string,
  tenantId: string,
  active: boolean,
): Promise<Tenant> =>
  apiRequest(`/admin/api/tenants/${tenantId}/active`, tenantSchema, {
    method: 'PUT',
    headers: withBearerToken(token),
    body: JSON.stringify({ active }),
  });

export const listApiKeys = (token: string, tenantId: string): Promise<ApiKeyItem[]> =>
  apiRequest(`/admin/api/tenants/${tenantId}/api-keys`, z.array(apiKeySchema), {
    headers: withBearerToken(token),
  });

export const createApiKey = (
  token: string,
  tenantId: string,
  name: string,
): Promise<ApiKeyCreated> =>
  apiRequest(`/admin/api/tenants/${tenantId}/api-keys`, apiKeyCreatedSchema, {
    method: 'POST',
    headers: withBearerToken(token),
    body: JSON.stringify({ name }),
  });

export const revokeApiKey = (token: string, tenantId: string, keyId: string): Promise<ApiKeyItem> =>
  apiRequest(`/admin/api/tenants/${tenantId}/api-keys/${keyId}`, apiKeySchema, {
    method: 'DELETE',
    headers: withBearerToken(token),
  });

export const listInvites = (token: string, tenantId: string): Promise<InviteItem[]> =>
  apiRequest(`/admin/api/tenants/${tenantId}/invites`, z.array(inviteSchema), {
    headers: withBearerToken(token),
  });

export const createInvite = (token: string, tenantId: string): Promise<InviteCreated> =>
  apiRequest(`/admin/api/tenants/${tenantId}/invites`, inviteCreatedSchema, {
    method: 'POST',
    headers: withBearerToken(token),
  });

export const deleteInvite = (
  token: string,
  tenantId: string,
  inviteId: string,
): Promise<{ message: string }> =>
  apiRequest(`/admin/api/tenants/${tenantId}/invites/${inviteId}`, okMessageSchema, {
    method: 'DELETE',
    headers: withBearerToken(token),
  });

export const getTenantSequences = (token: string, tenantId: string): Promise<TenantSequences> =>
  apiRequest(`/admin/api/tenants/${tenantId}/sequences`, tenantSequencesSchema, {
    headers: withBearerToken(token),
  });

/**
 * `ultimoSecuencial` is the LAST number the tenant emitted, so the next
 * document will be that plus one. The endpoint refuses to lower a counter
 * (409): lowering is the only change that guarantees duplicate claves de
 * acceso, which the SRI rejects.
 */
export const seedTenantSequence = (
  token: string,
  tenantId: string,
  documentType: string,
  ultimoSecuencial: number,
): Promise<SequenceSeedResult> =>
  apiRequest(`/admin/api/tenants/${tenantId}/sequences/${documentType}`, sequenceSeedResultSchema, {
    method: 'PUT',
    headers: withBearerToken(token),
    body: JSON.stringify({ ultimo_secuencial: ultimoSecuencial }),
  });

export const getTenantUsage = (token: string, tenantId: string): Promise<UsageRow[]> =>
  apiRequest(`/admin/api/tenants/${tenantId}/usage`, z.array(usageRowSchema), {
    headers: withBearerToken(token),
  });

export const getUsageSummary = (token: string): Promise<UsageSummaryRow[]> =>
  apiRequest('/admin/api/usage/summary', z.array(usageSummaryRowSchema), {
    headers: withBearerToken(token),
  });
