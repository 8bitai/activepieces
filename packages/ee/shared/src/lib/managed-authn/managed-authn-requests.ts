import { Static, Type } from '@sinclair/typebox'

export const ManagedAuthnRequestBody = Type.Object({
    // Optional when using session cookie (AP_EMBED_SESSION_COOKIE_NAME); client sends credentials: 'include'
    externalAccessToken: Type.Optional(Type.String()),
})

export type ManagedAuthnRequestBody = Static<typeof ManagedAuthnRequestBody>
