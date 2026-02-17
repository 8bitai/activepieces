import { AppSystemProp } from '@activepieces/server-shared'
import { ActivepiecesError, DefaultProjectRole, ErrorCode, isNil, PiecesFilterType } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { platformService } from '../../../platform/platform.service'
import { projectRoleService } from '../../projects/project-role/project-role.service'
import { system } from '../../../helper/system/system'
import type { ExternalPrincipal } from './external-token-extractor'

/** Existing gateway endpoint: GET with Bearer returns { active, principal } (snake_case). */
const DEFAULT_VALIDATE_PATH = '/api/v1/sso/validate'

/** Response from GET /api/v1/sso/validate (existing gateway endpoint). */
export type NeutrinoGatewayValidateResponse = {
    active: boolean
    principal?: {
        user_id: string
        tenant_id: string
        tenant_name?: string
        name?: string
        email?: string
    }
}

export function isNeutrinoGatewayEnabled(): boolean {
    const enabled = system.getBoolean(AppSystemProp.EMBED_AUTH_VIA_NEUTRINO_GATEWAY)
    const url = system.get(AppSystemProp.NEUTRINO_GATEWAY_URL)
    return enabled === true && !isNil(url) && url.length > 0
}

export async function validateTokenViaNeutrinoGateway(
    log: FastifyBaseLogger,
    token: string,
): Promise<ExternalPrincipal | null> {
    if (!isNeutrinoGatewayEnabled()) {
        return null
    }

    const baseUrl = system.getOrThrow(AppSystemProp.NEUTRINO_GATEWAY_URL).replace(/\/$/, '')
    const pathRaw = system.get(AppSystemProp.NEUTRINO_GATEWAY_VALIDATE_PATH)
    const path = (typeof pathRaw === 'string' && pathRaw.length > 0) ? pathRaw : DEFAULT_VALIDATE_PATH
    const platformId = system.get(AppSystemProp.EMBED_PLATFORM_ID)
    const pathNorm = path.startsWith('/') ? path : `/${path}`
    const url = `${baseUrl}${pathNorm}`

    log.info({ name: 'NeutrinoGatewayValidator', url, baseUrl }, 'Calling Neutrino gateway to validate token')

    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        })

        log.info({ name: 'NeutrinoGatewayValidator', status: res.status, url }, 'Neutrino gateway responded')
        if (!res.ok) {
            log.warn({ name: 'NeutrinoGatewayValidator', status: res.status, url }, 'Neutrino gateway validation failed')
            throw new ActivepiecesError({
                code: ErrorCode.INVALID_BEARER_TOKEN,
                params: { message: 'Neutrino gateway rejected the token' },
            })
        }

        const data = (await res.json()) as NeutrinoGatewayValidateResponse
        if (!data.active || !data.principal) {
            throw new ActivepiecesError({
                code: ErrorCode.INVALID_BEARER_TOKEN,
                params: { message: 'Neutrino gateway returned inactive or missing principal' },
            })
        }

        const p = data.principal
        const externalUserId = p.user_id ?? ''
        const externalProjectId = p.tenant_id ?? ''

        if (!externalUserId || !externalProjectId) {
            throw new ActivepiecesError({
                code: ErrorCode.INVALID_BEARER_TOKEN,
                params: { message: 'Neutrino gateway response missing user_id or tenant_id' },
            })
        }

        let resolvedPlatformId: string
        if (platformId) {
            resolvedPlatformId = platformId
        } else {
            const all = await platformService.getAll()
            if (all.length === 1) {
                resolvedPlatformId = all[0].id
            } else if (all.length === 0) {
                throw new ActivepiecesError({
                    code: ErrorCode.INVALID_BEARER_TOKEN,
                    params: { message: 'No platform exists; sign up once in Activepieces to create one' },
                })
            } else {
                throw new ActivepiecesError({
                    code: ErrorCode.INVALID_BEARER_TOKEN,
                    params: { message: 'Multiple platforms exist; set AP_EMBED_PLATFORM_ID to the desired platform id' },
                })
            }
        }

        const { firstName, lastName } = splitName(p.name ?? '')
        const projectRole = await getProjectRoleFromGateway(undefined, resolvedPlatformId)
        log.info({ name: 'NeutrinoGatewayValidator', externalUserId: externalUserId.slice(0, 8), platformId: resolvedPlatformId }, 'Neutrino gateway validation succeeded')
        return {
            platformId: resolvedPlatformId,
            externalUserId,
            externalProjectId,
            externalFirstName: firstName,
            externalLastName: lastName,
            projectRole: projectRole.name,
            pieces: { filterType: PiecesFilterType.NONE, tags: [] },
            projectDisplayName: p.tenant_name,
        }
    } catch (e) {
        if (e instanceof ActivepiecesError) throw e
        log.error({ name: 'NeutrinoGatewayValidator', error: e }, 'Neutrino gateway request failed')
        throw new ActivepiecesError({
            code: ErrorCode.INVALID_BEARER_TOKEN,
            params: { message: e instanceof Error ? e.message : 'Neutrino gateway validation failed' },
        })
    }
}

function splitName(name: string): { firstName: string; lastName: string } {
    if (!name?.trim()) return { firstName: '', lastName: '' }
    const parts = name.trim().split(/\s+/, 2)
    return { firstName: parts[0] ?? '', lastName: parts[1] ?? '' }
}

async function getProjectRoleFromGateway(role: string | undefined, platformId: string) {
    if (role) {
        try {
            return await projectRoleService.getOneOrThrow({ name: role, platformId })
        } catch {
            // fallback to default
        }
    }
    return projectRoleService.getOneOrThrow({
        name: DefaultProjectRole.EDITOR,
        platformId,
    })
}
