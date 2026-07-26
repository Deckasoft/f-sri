import { apiRequest } from './client';
import {
  invitePreviewSchema,
  onboardingCompleteResponseSchema,
  type InvitePreview,
  type OnboardingCompleteResponse,
} from './types';

export const getInvitePreview = (token: string): Promise<InvitePreview> =>
  apiRequest(`/onboarding/api/invite/${encodeURIComponent(token)}`, invitePreviewSchema);

export interface CompleteOnboardingInput {
  token: string;
  certificateBase64: string;
  certificatePassword: string;
  contactEmail?: string;
}

export const completeOnboarding = (
  input: CompleteOnboardingInput,
): Promise<OnboardingCompleteResponse> =>
  apiRequest('/onboarding/api/complete', onboardingCompleteResponseSchema, {
    method: 'POST',
    body: JSON.stringify({
      token: input.token,
      certificate: input.certificateBase64,
      certificate_password: input.certificatePassword,
      ...(input.contactEmail ? { contact_email: input.contactEmail } : {}),
    }),
  });
