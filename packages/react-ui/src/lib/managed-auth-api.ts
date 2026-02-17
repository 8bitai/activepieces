import { api } from '@/lib/api';
import { ManagedAuthnRequestBody } from '@activepieces/ee-shared';
import { AuthenticationResponse } from '@activepieces/shared';

export const managedAuthApi = {
  /** With token: body. Without: sends credentials (cookie). No embed-token endpoint needed. */
  generateApToken: async (request?: ManagedAuthnRequestBody) => {
    const token = request?.externalAccessToken?.trim();
    if (token) {
      return api.post<AuthenticationResponse>(
        `/v1/managed-authn/external-token`,
        { externalAccessToken: token },
      );
    }
    return api.any<AuthenticationResponse>(`/v1/managed-authn/external-token`, {
      method: 'POST',
      data: {},
      withCredentials: true,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
