import { EngineConstants } from '../handler/context/engine-constants'

export const cancelService = {
    async isCanceled(constants: EngineConstants): Promise<boolean> {
        const url = `${constants.internalApiUrl}v1/engine/check-cancel?flowRunId=${constants.flowRunId}`
        try {
            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${constants.engineToken}`,
                },
            })
            if (!response.ok) return false
            const data = await response.json() as { canceled: boolean }
            return data.canceled
        }
        catch {
            return false
        }
    },
}
