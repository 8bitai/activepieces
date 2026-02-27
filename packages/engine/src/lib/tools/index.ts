import { Action, DropdownOption, ExecutePropsResult, PieceProperty, PropertyType } from '@activepieces/pieces-framework'
import { AgentPieceTool, ExecuteToolOperation, ExecuteToolResponse, ExecutionToolStatus, FieldControlMode, FlowActionType, isNil, PieceAction, PropertyExecutionType, StepOutputStatus } from '@activepieces/shared'
import { generateText, JSONParseError, LanguageModel, NoObjectGeneratedError, Output, Tool, zodSchema } from 'ai'
import { z } from 'zod'
import { EngineConstants } from '../handler/context/engine-constants'
import { FlowExecutorContext } from '../handler/context/flow-execution-context'
import { flowExecutor } from '../handler/flow-executor'
import { pieceHelper } from '../helper/piece-helper'
import { pieceLoader } from '../helper/piece-loader'
import { tsort } from './tsort'

export const agentTools = {
    async tools({ engineConstants, tools, model }: ConstructToolParams): Promise<Record<string, Tool>> {
        const piecesTools = await Promise.all(tools.map(async (tool) => {
            const { pieceAction } = await pieceLoader.getPieceAndActionOrThrow({
                pieceName: tool.pieceMetadata.pieceName,
                pieceVersion: tool.pieceMetadata.pieceVersion,
                actionName: tool.pieceMetadata.actionName,
                devPieces: EngineConstants.DEV_PIECES,
            })
            return {
                name: tool.toolName,
                description: pieceAction.description,
                inputSchema: z.object({
                    instruction: z.string().describe('The instruction to the tool'),
                }),
                execute: async ({ instruction }: { instruction: string }) =>
                    execute({
                        ...engineConstants,
                        instruction,
                        pieceName: tool.pieceMetadata.pieceName,
                        pieceVersion: tool.pieceMetadata.pieceVersion,
                        actionName: tool.pieceMetadata.actionName,
                        predefinedInput: tool.pieceMetadata.predefinedInput,
                        model,
                    }),
            }
        }))

        return {
            ...Object.fromEntries(piecesTools.map((tool) => [tool.name, tool])),
        }
    },
}

async function resolveProperties(
    depthToPropertyMap: Record<number, string[]>,
    instruction: string,
    action: Action,
    model: LanguageModel,
    operation: ExecuteToolOperation,
): Promise<Record<string, unknown>> {
    const auth = operation.predefinedInput?.auth
    const predefinedInputsFields = operation.predefinedInput?.fields || {}

    let result: Record<string, unknown> = {}

    if (auth) {
        result.auth = auth
    }

    for (const [propertyName, field] of Object.entries(predefinedInputsFields)) {
        if (field.mode === FieldControlMode.CHOOSE_YOURSELF) {
            result[propertyName] = field.value
        }
        else if (field.mode === FieldControlMode.LEAVE_EMPTY) {
            result[propertyName] = undefined
        }
    }

    for (const [_, properties] of Object.entries(depthToPropertyMap)) {
        const propertyToFill: Record<string, z.ZodTypeAny> = {}
        const propertyDetails: PropertyDetail[] = []

        for (const property of properties) {
            const propertyFromAction = action.props[property]
            const propertyType = propertyFromAction.type
            const skipTypes = [
                PropertyType.BASIC_AUTH,
                PropertyType.OAUTH2,
                PropertyType.CUSTOM_AUTH,
                PropertyType.CUSTOM,
                PropertyType.MARKDOWN,
            ]
            if (skipTypes.includes(propertyType) || property in result) {
                continue
            }

            const propertySchema = await propertyToSchema(
                property,
                propertyFromAction,
                operation,
                result,
            )
            propertyToFill[property] = propertySchema

            const propertyDetail = await buildPropertyDetail(
                property,
                propertyFromAction,
                operation,
                result,
            )
            if (!isNil(propertyDetail)) {
                propertyDetails.push(propertyDetail)
            }
        }

        if (Object.keys(propertyToFill).length === 0) continue

        const schemaObject = zodSchema(z.object(propertyToFill).strict())
        const extractionPrompt = constructExtractionPrompt(
            instruction,
            propertyToFill,
            propertyDetails,
            result,
        )

        const { output } = await generateText({
            model,
            prompt: extractionPrompt,
            output: Output.object({
                schema: schemaObject,

            }),
            
        }).catch(error => {
            if (NoObjectGeneratedError.isInstance(error) && JSONParseError.isInstance(error.cause) && error.text?.startsWith('```json') && error.text?.endsWith('```')) {
                return {
                    output: JSON.parse(error.text.replace('```json', '').replace('```', '')),
                }
            }
            throw error
        })

        const extracted = output as Record<string, unknown>
        for (const detail of propertyDetails) {
            if (detail.options && detail.options.length > 0 && detail.name in extracted) {
                extracted[detail.name] = matchDropdownValue(extracted[detail.name], detail.options)
            }
        }

        result = {
            ...result,
            ...extracted,
        }

    }
    return result
}

async function execute(operation: ExecuteToolOperationWithModel): Promise<ExecuteToolResponse> {
    try {
        const { pieceAction } = await pieceLoader.getPieceAndActionOrThrow({
            pieceName: operation.pieceName,
            pieceVersion: operation.pieceVersion,
            actionName: operation.actionName,
            devPieces: EngineConstants.DEV_PIECES,
        })
        const depthToPropertyMap = tsort.sortPropertiesByDependencies(pieceAction.props)
        const resolvedInput = await resolveProperties(depthToPropertyMap, operation.instruction, pieceAction, operation.model, operation)
        const step: PieceAction = {
            name: operation.actionName,
            displayName: operation.actionName,
            type: FlowActionType.PIECE,
            settings: {
                input: resolvedInput,
                actionName: operation.actionName,
                pieceName: operation.pieceName,
                pieceVersion: operation.pieceVersion,
                propertySettings: Object.fromEntries(Object.entries(resolvedInput).map(([key]) => [key, {
                    type: PropertyExecutionType.MANUAL,
                    schema: undefined,
                }])),
            },
            valid: true,
        }
        const output = await flowExecutor.getExecutorForAction(step.type).handle({
            action: step,
            executionState: FlowExecutorContext.empty(),
            constants: EngineConstants.fromExecuteActionInput(operation),
        })
        const { output: stepOutput, errorMessage, status } = output.steps[operation.actionName]
        return {
            status: status === StepOutputStatus.FAILED ? ExecutionToolStatus.FAILED : ExecutionToolStatus.SUCCESS,
            output: stepOutput,
            resolvedInput: {
                ...resolvedInput,
                auth: 'Redacted',
            },
            errorMessage,
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('[agent-tool-execute] Tool execution failed:', errorMessage, error instanceof Error ? error.stack : '')
        return {
            status: ExecutionToolStatus.FAILED,
            output: undefined,
            resolvedInput: {},
            errorMessage: `Tool execution error: ${errorMessage}`,
        }
    }
}

const constructExtractionPrompt = (
    instruction: string,
    propertyToFill: Record<string, z.ZodTypeAny>,
    propertyDetails: PropertyDetail[],
    existingValues: Record<string, unknown>,
): string => {
    const propertyNames = Object.keys(propertyToFill).join('", "')

    const existingValuesContext = Object.keys(existingValues).length > 0
        ? buildExistingValuesSection(existingValues)
        : ''

    const propertyDetailsSection = propertyDetails.length > 0
        ? buildPropertyDetailsSection(propertyDetails)
        : ''

    return `
You are an expert at understanding API schemas and filling out properties based on user instructions.

**TASK**:
- Fill out the properties "${propertyNames}" based on the user's instructions.
- Output must be a valid JSON object matching the schema.

**USER INSTRUCTIONS**:
${instruction}

${existingValuesContext}

${propertyDetailsSection}

**RULES** (MUST FOLLOW):
- For dropdown, multi-select dropdown, and static dropdown properties: Select values ONLY from the provided options array. Use the 'value' field from the option objects.
- For array properties: Select values ONLY from the provided options array if specified.
- For dynamic properties: Select values ONLY from the provided options array if specified.
- Options format: [{ label: string, value: string | object | number | boolean }]
- For DATE_TIME properties: Use ISO format (YYYY-MM-DDTHH:mm:ss.sssZ)
- Use actual values from the user instructions to determine property values.
- Use already filled values as context for consistency.
- Required properties: MUST include all, even if missing from instructions. Infer reasonable defaults or look for hints if possible.
- Optional properties: Skip if no information is available—do not invent values.
- Do not add extra properties outside the requested ones.
- Ensure output is parseable JSON without additional text.
`
}

async function loadDropdownLabels(propertyName: string, property: PieceProperty, operation: ExecuteToolOperation, resolvedInput: Record<string, unknown>): Promise<string[]> {
    try {
        let options: DropdownOption<unknown>[] = []
        if (property.type === PropertyType.STATIC_DROPDOWN || property.type === PropertyType.STATIC_MULTI_SELECT_DROPDOWN) {
            options = 'options' in property && property.options && typeof property.options === 'object' && 'options' in property.options
                ? (property.options as { options: DropdownOption<unknown>[] }).options
                : []
        } else {
            options = await loadOptions(propertyName, operation, resolvedInput)
        }
        return options.map(o => o.label).filter(l => typeof l === 'string' && l.length > 0)
    }
    catch {
        return []
    }
}

function matchDropdownValue(extractedValue: unknown, options: DropdownOption<unknown>[]): unknown {
    if (options.length === 0) return extractedValue
    const exact = options.find(o => JSON.stringify(o.value) === JSON.stringify(extractedValue))
    if (exact) return exact.value
    const extractedStr = typeof extractedValue === 'string' ? extractedValue : JSON.stringify(extractedValue)
    const byLabel = options.find(o => o.label.toLowerCase() === extractedStr.toLowerCase())
    if (byLabel) return byLabel.value
    const byLabelContains = options.find(o => extractedStr.toLowerCase().includes(o.label.toLowerCase()))
    if (byLabelContains) return byLabelContains.value
    if (typeof extractedValue === 'object' && extractedValue !== null) {
        const extractedObj = extractedValue as Record<string, unknown>
        for (const option of options) {
            if (typeof option.value === 'object' && option.value !== null) {
                const optionObj = option.value as Record<string, unknown>
                const sharedKey = Object.keys(extractedObj).find(k => k in optionObj && extractedObj[k] === optionObj[k])
                if (sharedKey) return option.value
            }
        }
    }
    return options[0].value
}

type ExecuteToolOperationWithModel = ExecuteToolOperation & {
    model: LanguageModel
}

async function propertyToSchema(propertyName: string, property: PieceProperty, operation: ExecuteToolOperation, resolvedInput: Record<string, unknown>): Promise<z.ZodTypeAny> {
    let schema: z.ZodTypeAny

    switch (property.type) {
        case PropertyType.SHORT_TEXT:
        case PropertyType.LONG_TEXT:
        case PropertyType.MARKDOWN:
        case PropertyType.DATE_TIME:
        case PropertyType.FILE:
        case PropertyType.COLOR:
            schema = z.string()
            break
        case PropertyType.DROPDOWN:
        case PropertyType.STATIC_DROPDOWN: {
            const optionsForSchema = await loadDropdownLabels(propertyName, property, operation, resolvedInput)
            if (optionsForSchema.length > 0) {
                schema = z.enum(optionsForSchema as [string, ...string[]])
            } else {
                schema = z.union([z.string(), z.number(), z.object({}).loose()])
            }
            break
        }
        case PropertyType.MULTI_SELECT_DROPDOWN:
        case PropertyType.STATIC_MULTI_SELECT_DROPDOWN: {
            schema = z.union([z.array(z.string()), z.array(z.object({}).loose())])
            break
        }
        case PropertyType.NUMBER:
            schema = z.number()
            break
        case PropertyType.ARRAY:
            return z.array(z.string())
        case PropertyType.OBJECT:
            schema = z.object({}).loose()
            break
        case PropertyType.JSON:
            schema = z.object({}).loose()
            break
        case PropertyType.DYNAMIC: {
            schema = await buildDynamicSchema(propertyName, operation, resolvedInput)
            break
        }
        case PropertyType.CHECKBOX:
            schema = z.boolean()
            break
        case PropertyType.CUSTOM:
            schema = z.string()
            break
        case PropertyType.OAUTH2:
        case PropertyType.BASIC_AUTH:
        case PropertyType.CUSTOM_AUTH:
        case PropertyType.SECRET_TEXT:
            throw new Error(`Unsupported property type: ${property.type}`)
    }
    if (property.description) {
        schema = schema.describe(property.description)
    }
    return property.required ? schema : schema.nullable()
}

async function buildDynamicSchema(propertyName: string, operation: ExecuteToolOperation, resolvedInput: Record<string, unknown>): Promise<z.ZodTypeAny> {
    const response = await pieceHelper.executeProps({
        ...operation,
        propertyName,
        actionOrTriggerName: operation.actionName,
        input: resolvedInput,
        sampleData: {},
        searchValue: undefined,
    }) as unknown as ExecutePropsResult<PropertyType.DYNAMIC>
    const dynamicProperties = response.options
    if (!dynamicProperties || typeof dynamicProperties !== 'object' || 'disabled' in dynamicProperties) {
        return z.object({}).loose()
    }
    const dynamicSchema: Record<string, z.ZodTypeAny> = {}
    for (const [key, value] of Object.entries(dynamicProperties)) {
        if (!value || typeof value !== 'object' || !('type' in value)) continue
        let schema = await propertyToSchema(key, value, operation, resolvedInput)
        if (value.defaultValue != null && (value.type === PropertyType.OBJECT || value.type === PropertyType.JSON)) {
            const schemaFromDefault = tryBuildSchemaFromDefault(value.defaultValue)
            if (schemaFromDefault) {
                schema = schemaFromDefault
            } else {
                const hint = typeof value.defaultValue === 'string' ? value.defaultValue : JSON.stringify(value.defaultValue)
                schema = schema.describe(`Expected structure: ${hint}`)
            }
        }
        dynamicSchema[key] = schema
    }
    return z.object(dynamicSchema).loose()
}

function tryBuildSchemaFromDefault(defaultValue: unknown): z.ZodTypeAny | null {
    if (typeof defaultValue !== 'object' || defaultValue === null) return null
    const schema = defaultValue as Record<string, unknown>
    if (schema.type !== 'object' || typeof schema.properties !== 'object' || schema.properties === null) return null
    const properties = schema.properties as Record<string, { type?: string; description?: string }>
    const requiredFields = Array.isArray(schema.required) ? schema.required as string[] : []
    const shape: Record<string, z.ZodTypeAny> = {}
    for (const [fieldName, fieldDef] of Object.entries(properties)) {
        let fieldSchema: z.ZodTypeAny
        switch (fieldDef.type) {
            case 'number':
            case 'integer':
                fieldSchema = z.number()
                break
            case 'boolean':
                fieldSchema = z.boolean()
                break
            case 'array':
                fieldSchema = z.array(z.unknown())
                break
            default:
                fieldSchema = z.string()
                break
        }
        if (fieldDef.description) {
            fieldSchema = fieldSchema.describe(fieldDef.description)
        }
        if (!requiredFields.includes(fieldName)) {
            fieldSchema = fieldSchema.nullable()
        }
        shape[fieldName] = fieldSchema
    }
    return z.object(shape).loose()
}

type PropertyDetail = {
    name: string
    type: PropertyType
    description?: string
    options?: DropdownOption<unknown>[]
    defaultValue?: unknown
}

async function buildPropertyDetail(propertyName: string, property: PieceProperty, operation: ExecuteToolOperation, input: Record<string, unknown>): Promise<PropertyDetail | null> {
    const baseDetail: PropertyDetail = {
        name: propertyName,
        type: property.type,
        description: property.description,
        defaultValue: property.defaultValue,
    }

    if (
        property.type === PropertyType.STATIC_DROPDOWN ||
        property.type === PropertyType.STATIC_MULTI_SELECT_DROPDOWN
    ) {
        const staticOptions = 'options' in property && property.options && typeof property.options === 'object' && 'options' in property.options
            ? (property.options as { options: DropdownOption<unknown>[] }).options
            : []
        return {
            ...baseDetail,
            options: staticOptions,
        }
    }

    if (
        property.type === PropertyType.DROPDOWN ||
        property.type === PropertyType.MULTI_SELECT_DROPDOWN
    ) {
        const options = await loadOptions(propertyName, operation, input)
        return {
            ...baseDetail,
            options,
        }
    }

    return baseDetail
}

async function loadOptions(propertyName: string, operation: ExecuteToolOperation, input: Record<string, unknown>): Promise<DropdownOption<unknown>[]> {
    const response = await pieceHelper.executeProps({
        ...operation,
        propertyName,
        actionOrTriggerName: operation.actionName,
        input,
        sampleData: {},
        searchValue: undefined,
    }) as unknown as ExecutePropsResult<PropertyType.DROPDOWN | PropertyType.MULTI_SELECT_DROPDOWN>
    const options = response.options
    return options.options
}

function buildExistingValuesSection(existingValues: Record<string, unknown>): string {
    return `
**ALREADY FILLED VALUES** (use for context and consistency):
${JSON.stringify(existingValues, null, 2)}
`
}

function buildPropertyDetailsSection(propertyDetails: PropertyDetail[]): string {
    const sections = propertyDetails.map(detail => {
        let content = `- Name: ${detail.name}\n  Type: ${detail.type}`
        if (detail.description) {
            content += `\n  Description: ${detail.description}`
        }
        if (detail.options && detail.options.length > 0) {
            content += `\n  Options: ${JSON.stringify(detail.options, null, 2)}`
        }
        if (detail.defaultValue !== undefined) {
            const defaultStr = typeof detail.defaultValue === 'string' ? detail.defaultValue : JSON.stringify(detail.defaultValue, null, 2)
            content += `\n  Expected Schema/Default: ${defaultStr}`
        }
        return content
    }).join('\n\n')

    return `
**PROPERTY DETAILS**:
${sections}
`
}

type ConstructToolParams = {
    engineConstants: EngineConstants
    tools: AgentPieceTool[]
    model: LanguageModel
}