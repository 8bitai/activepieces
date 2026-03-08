import { Static, Type } from '@sinclair/typebox'
import { ApId } from '../../common/id-generator'
import { FlowRunStatus } from '../execution/flow-execution'

export const ListFlowRunsRequestQuery = Type.Object({
    flowId: Type.Optional(Type.Array(ApId)),
    tags: Type.Optional(Type.Array(Type.String({}))),
    status: Type.Optional(Type.Array(Type.Enum(FlowRunStatus))),
    limit: Type.Optional(Type.Number({})),
    cursor: Type.Optional(Type.String({})),
    createdAfter: Type.Optional(Type.String({})),
    createdBefore: Type.Optional(Type.String({})),
    projectId: ApId,
    failedStepName: Type.Optional(Type.String({})),
    flowRunIds: Type.Optional(Type.Array(ApId)),
    includeArchived: Type.Optional(Type.Boolean({})),
    /** When true, return only top-level runs (no parentRunId). Use for runs table to show orchestrator runs only. */
    parentRunIdOnly: Type.Optional(Type.Boolean({})),
    /** When set, return only child runs of this flow run. Use to list subflows called by a run. */
    parentRunId: Type.Optional(ApId),
})

export type ListFlowRunsRequestQuery = Static<typeof ListFlowRunsRequestQuery>
