import { ApplicationEventName, ManagedAuthnRequestBody } from '@activepieces/ee-shared'
import { AppSystemProp, securityAccess } from '@activepieces/server-shared'
import { ActivepiecesError, AuthenticationResponse, ErrorCode } from '@activepieces/shared'
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { applicationEvents } from '../../helper/application-events'
import { system } from '../../helper/system/system'
import { managedAuthnService } from './managed-authn-service'

function getTokenFromCookie(cookieHeader: string | undefined, cookieName: string): string | null {
    if (!cookieHeader?.trim() || !cookieName?.trim()) return null
    for (const part of cookieHeader.split(';').map(p => p.trim())) {
        const eq = part.indexOf('=')
        if (eq > 0 && part.slice(0, eq).trim() === cookieName.trim())
            return part.slice(eq + 1).trim() || null
    }
    return null
}

export const managedAuthnController: FastifyPluginAsyncTypebox = async (
    app,
) => {
    app.post(
        '/external-token',
        ManagedAuthnRequest,
        async (req): Promise<AuthenticationResponse> => {
            const cookieName = system.get(AppSystemProp.EMBED_SESSION_COOKIE_NAME)
            const tokenFromCookie = cookieName ? getTokenFromCookie(req.headers.cookie, cookieName) : null
            // When cookie name is set, use only cookie (no body). Otherwise use body token.
            const externalAccessToken = cookieName
                ? (tokenFromCookie ?? '').trim()
                : (req.body?.externalAccessToken ?? '').trim()
            if (!externalAccessToken) {
                throw new ActivepiecesError({
                    code: ErrorCode.INVALID_BEARER_TOKEN,
                    params: {
                        message: cookieName
                            ? 'Missing session cookie: send request with credentials: "include" so the cookie is sent'
                            : 'Missing externalAccessToken in body',
                    },
                })
            }
            req.log.info({ name: 'managed-authn', fromCookie: !!cookieName }, 'POST /external-token received')
            try {
                const response = await managedAuthnService(req.log).externalToken({
                    externalAccessToken: externalAccessToken as string,
                })
                applicationEvents(req.log).sendUserEvent(req, {
                    action: ApplicationEventName.USER_SIGNED_UP,
                    data: {
                        source: 'managed',
                    },
                })
                return response
            } catch (e) {
                if (e instanceof ActivepiecesError) throw e
                req.log.error({ err: e }, 'managed-authn external-token failed')
                const isEntityNotFound = e != null && typeof e === 'object' &&
                    ((e as Error).name === 'EntityNotFoundError' || (e as Error).constructor?.name === 'EntityNotFoundError')
                if (isEntityNotFound) {
                    throw new ActivepiecesError({
                        code: ErrorCode.ENTITY_NOT_FOUND,
                        params: { message: 'User or project setup incomplete for embed auth', entityType: 'UserIdentity', entityId: '' },
                    })
                }
                throw new ActivepiecesError({
                    code: ErrorCode.INVALID_BEARER_TOKEN,
                    params: { message: 'Embed authentication failed' },
                })
            }
        },
    )
}

const ManagedAuthnRequest = {
    config: {
        security: securityAccess.public(),
    },
    schema: {
        body: ManagedAuthnRequestBody,
    },
}
