import {
    ActivepiecesError,
    ErrorCode,
    isNil,
    ListTemplatesRequestQuery,
    SeekPage,
    Template,
} from '@activepieces/shared'

const TEMPLATES_SOURCE_URL = 'https://cloud.activepieces.com/api/v1/templates'
const CLOUD_FETCH_TIMEOUT_MS = 3000

async function fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CLOUD_FETCH_TIMEOUT_MS)
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
        })
        return response
    }
    finally {
        clearTimeout(timer)
    }
}

export const communityTemplates = {
    getOrThrow: async (id: string): Promise<Template> => {
        const url = `${TEMPLATES_SOURCE_URL}/${id}`
        let response: Response
        try {
            response = await fetchWithTimeout(url)
        }
        catch {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'template',
                    entityId: id,
                    message: `Template ${id} not found`,
                },
            })
        }
        if (!response.ok) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'template',
                    entityId: id,
                    message: `Template ${id} not found`,
                },
            })
        }
        const template = await response.json()
        return template
    },
    getCategories: async (): Promise<string[]> => {
        const url = `${TEMPLATES_SOURCE_URL}/categories`
        try {
            console.log('[communityTemplates] fetching categories from cloud...')
            const response = await fetchWithTimeout(url)
            const categories = await response.json()
            console.log('[communityTemplates] categories fetched OK')
            return categories
        }
        catch (err) {
            console.warn('[communityTemplates] getCategories failed/timed out, returning []', (err as Error).message)
            return []
        }
    },
    list: async (request: ListTemplatesRequestQuery): Promise<SeekPage<Template>> => {
        const queryString = convertToQueryString(request)
        const url = `${TEMPLATES_SOURCE_URL}?${queryString}`
        try {
            console.log('[communityTemplates] fetching templates list from cloud...', queryString)
            const response = await fetchWithTimeout(url)
            const templates = await response.json()
            console.log('[communityTemplates] templates list fetched OK')
            return templates
        }
        catch (err) {
            console.warn('[communityTemplates] list failed/timed out, returning empty', (err as Error).message)
            return { data: [], next: null, previous: null }
        }
    },
}


function convertToQueryString(params: ListTemplatesRequestQuery): string {
    const searchParams = new URLSearchParams()

    Object.entries(params).forEach(([key, value]) => {
        if (Array.isArray(value)) {
            value.forEach((val) => {
                if (!isNil(val)) {
                    searchParams.append(key, typeof val === 'string' ? val : JSON.stringify(val))
                }
            })
        }
        else if (!isNil(value)) {
            searchParams.set(key, value.toString())
        }
    })

    return searchParams.toString()
}
