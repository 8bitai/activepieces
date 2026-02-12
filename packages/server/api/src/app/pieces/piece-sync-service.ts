import { AppSystemProp, apVersionUtil, rejectedPromiseHandler } from '@activepieces/server-shared'
import { groupBy, PieceSyncMode, PieceType } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import semver from 'semver'
import { system } from '../helper/system/system'
import { SystemJobName } from '../helper/system-jobs/common'
import { systemJobHandlers } from '../helper/system-jobs/job-handlers'
import { systemJobsSchedule } from '../helper/system-jobs/system-job'
import { localPieceCache } from './metadata/local-piece-cache'
import { PieceMetadataSchema } from './metadata/piece-metadata-entity'
import { pieceMetadataService, pieceRepos } from './metadata/piece-metadata-service'

const CLOUD_API_URL = 'https://cloud.activepieces.com/api/v1/pieces'
const syncMode = system.get<PieceSyncMode>(AppSystemProp.PIECES_SYNC_MODE)
const piecesFilter = system.getList(AppSystemProp.PIECES_FILTER)

export const pieceSyncService = (log: FastifyBaseLogger) => ({
    async setup(): Promise<void> {
        systemJobHandlers.registerJobHandler(SystemJobName.PIECES_SYNC, async function syncPiecesJobHandler(): Promise<void> {
            await pieceSyncService(log).sync()
        })
        rejectedPromiseHandler(pieceSyncService(log).sync(), log)
        await systemJobsSchedule(log).upsertJob({
            job: {
                name: SystemJobName.PIECES_SYNC,
                data: {},
            },
            schedule: {
                type: 'repeated',
                cron: `${Math.floor(Math.random() * 5)} */1 * * *`,
            },
        })
    },
    async sync(): Promise<void> {
        if (syncMode !== PieceSyncMode.OFFICIAL_AUTO) {
            log.info('Piece sync service is disabled')
            return
        }
        try {
            const hasFilter = piecesFilter.length > 0
            log.info({ piecesFilter: hasFilter ? piecesFilter : 'none (syncing all)' }, 'Starting piece synchronization')
            const startTime = performance.now()
            const [dbPieces, allCloudPieces] = await Promise.all([pieceRepos().find({
                select: {
                    name: true,
                    version: true,
                    pieceType: true,
                },
            }), listCloudPieces()])
            const cloudPieces = hasFilter
                ? filterPiecesByName(allCloudPieces, piecesFilter)
                : allCloudPieces
            const added = await installNewPieces(cloudPieces, dbPieces, log)
            const deleted = await deletePiecesIfNotOnCloud(dbPieces, cloudPieces, log, hasFilter ? piecesFilter : undefined)

            log.info({
                added,
                deleted,
                durationMs: Math.floor(performance.now() - startTime),
            }, 'Piece synchronization completed')
            await localPieceCache(log).refresh()
        }
        catch (error) {
            log.error({ error }, 'Error syncing pieces')
        }
    },
})

function filterPiecesByName(pieces: PieceRegistryResponse[], filter: string[]): PieceRegistryResponse[] {
    const allowedNames = new Set(filter.map(name => name.startsWith('@activepieces/piece-') ? name : `@activepieces/piece-${name}`))
    return pieces.filter(piece => allowedNames.has(piece.name))
}

async function deletePiecesIfNotOnCloud(dbPieces: PieceMetadataOnly[], cloudPieces: PieceRegistryResponse[], log: FastifyBaseLogger, filter?: string[]): Promise<number> {
    const cloudMap = new Map<string, true>(cloudPieces.map(cloudPiece => [`${cloudPiece.name}:${cloudPiece.version}`, true]))
    const filterSet = filter ? new Set(filter.map(name => name.startsWith('@activepieces/piece-') ? name : `@activepieces/piece-${name}`)) : undefined
    const piecesToDelete = dbPieces.filter(piece => {
        if (piece.pieceType !== PieceType.OFFICIAL) {
            return false
        }
        // When a filter is active, also delete pieces not in the filter
        if (filterSet && !filterSet.has(piece.name)) {
            return true
        }
        return !cloudMap.has(`${piece.name}:${piece.version}`)
    })
    await pieceMetadataService(log).bulkDelete(piecesToDelete.map(piece => ({ name: piece.name, version: piece.version })))
    return piecesToDelete.length
}

async function installNewPieces(cloudPieces: PieceRegistryResponse[], dbPieces: PieceMetadataOnly[], log: FastifyBaseLogger): Promise<number> {
    const dbMap = new Map<string, true>(dbPieces.map(dbPiece => [`${dbPiece.name}:${dbPiece.version}`, true]))
    const newPiecesToFetch = cloudPieces.filter(piece => !dbMap.has(`${piece.name}:${piece.version}`))
    const batchSize = 5
    for (let done = 0; done < newPiecesToFetch.length; done += batchSize) {
        const currentBatch = newPiecesToFetch.slice(done, done + batchSize)
        await Promise.all(currentBatch.map(async (piece) => {
            const url = `${CLOUD_API_URL}/${piece.name}${piece.version ? '?version=' + piece.version : ''}`
            const response = await fetch(url)
            if (!response.ok) {
                log.warn({ name: piece.name, version: piece.version, status: response.status }, 'Error reading piece metadata')
                return
            }
            const pieceMetadata = await response.json()
            await pieceMetadataService(log).create({
                pieceMetadata,
                packageType: pieceMetadata.packageType,
                pieceType: pieceMetadata.pieceType,
            })
        }))
    }
    return newPiecesToFetch.length
}


async function listCloudPieces(): Promise<PieceRegistryResponse[]> {
    const queryParams = new URLSearchParams()
    queryParams.append('edition', system.getEdition())
    queryParams.append('release', await apVersionUtil.getCurrentRelease())
    const response = await fetch(`${CLOUD_API_URL}/registry?${queryParams.toString()}`)
    if (!response.ok) {
        throw new Error(`Failed to fetch cloud pieces: ${response.status}`)
    }
    const pieces: PieceRegistryResponse[] = await response.json()
    const piecesByName = groupBy(pieces, p => p.name)
    const latest = []
    const others = []

    for (const group of Object.values(piecesByName)) {
        const sortedByVersion = sortByVersionDesc(group)
        latest.push(sortedByVersion[0])
        others.push(...sortedByVersion.slice(1))
    }

    return [...latest, ...others]
}

function sortByVersionDesc(items: PieceRegistryResponse[]) {
    return [...items].sort((a, b) =>
        semver.rcompare(a.version, b.version),
    )
}

type PieceRegistryResponse = {
    name: string
    version: string
}


type PieceMetadataOnly = Pick<PieceMetadataSchema, 'name' | 'version' | 'pieceType'>