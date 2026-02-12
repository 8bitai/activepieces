import {
  AgentResult,
  AgentStepBlock,
  AgentTaskStatus,
  AgentTool,
  AgentToolType,
  assertNotNullOrUndefined,
  ContentBlockType,
  ExecutionToolStatus,
  isNil,
  MarkdownContentBlock,
  ToolCallBase,
  ToolCallContentBlock,
  ToolCallStatus,
  ToolCallType,
} from '@activepieces/shared';

export const agentOutputBuilder = (prompt: string) => {
  let status: AgentTaskStatus = AgentTaskStatus.IN_PROGRESS;
  const steps: AgentStepBlock[] = [];
  let structuredOutput: Record<string, unknown> | undefined = undefined;

  return {
    setStatus(_status: AgentTaskStatus) {
      status = _status;
    },
    setStructuredOutput(output: Record<string, unknown>) {
      structuredOutput = output;
    },
    appendErrorToStructuredOutput(errorDetails: unknown) {
      if (structuredOutput) {
        structuredOutput["errors"] = [...(structuredOutput["errors"] as string[] || []), errorDetails];
      }
    },
    fail({ message }: FinishParams) {
      status = AgentTaskStatus.FAILED;
      if (!isNil(message)) {
        this.addMarkdown(message);
        this.appendErrorToStructuredOutput({ message });
      }
    },
    addMarkdown(markdown: string) {
      if (
        steps.length === 0 ||
        steps[steps.length - 1].type !== ContentBlockType.MARKDOWN
      ) {
        steps.push({
          type: ContentBlockType.MARKDOWN,
          markdown: '',
        });
      }
      (steps[steps.length - 1] as MarkdownContentBlock).markdown += markdown;
    },
    startToolCall({
      toolName,
      toolCallId,
      input,
      agentTools,
    }: StartToolCallParams) {
      const metadata = getToolMetadata({
        toolName,
        baseTool: {
          toolName,
          toolCallId,
          type: ContentBlockType.TOOL_CALL,
          status: ToolCallStatus.IN_PROGRESS,
          input,
          output: undefined,
          startTime: new Date().toISOString(),
        },
        tools: agentTools,
      });
      steps.push(metadata);
    },
    finishToolCall({ toolCallId, output }: FinishToolCallParams) {
      const toolIdx = steps.findIndex(
        (block) =>
          block.type === ContentBlockType.TOOL_CALL &&
          (block as ToolCallContentBlock).toolCallId === toolCallId
      );
      const tool = steps[toolIdx] as ToolCallContentBlock;
      assertNotNullOrUndefined(tool, 'Last block must be a tool call');
      steps[toolIdx] = {
        ...tool,
        status: ToolCallStatus.COMPLETED,
        endTime: new Date().toISOString(),
        output,
      };
    },
    failToolCall({ toolCallId }: FaildToolCallParams) {
      const toolIdx = steps.findIndex(
        (block) =>
          block.type === ContentBlockType.TOOL_CALL &&
          (block as ToolCallContentBlock).toolCallId === toolCallId
      );
      const tool = steps[toolIdx] as ToolCallContentBlock;
      assertNotNullOrUndefined(tool, 'Last block must be a tool call');
      steps[toolIdx] = {
        ...tool,
        status: ToolCallStatus.COMPLETED,
        endTime: new Date().toISOString(),
        output: {
          status: ExecutionToolStatus.FAILED
        },
      };
    },
    build(): AgentResult {
      return {
        status,
        steps,
        structuredOutput,
        prompt,
      };
    },
  };
};

type FinishToolCallParams = {
  toolCallId: string;
  output: Record<string, unknown>;
};

type FaildToolCallParams = {
  toolCallId: string;
};

type StartToolCallParams = {
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
  agentTools: AgentTool[];
};

type FinishParams = {
  message?: string;
};

function findMatchingTool(toolName: string, tools: AgentTool[]): AgentTool | undefined {
  // Exact match first (works for PIECE and FLOW tools)
  const exactMatch = tools.find((tool) => tool.toolName === toolName);
  if (exactMatch) {
    return exactMatch;
  }
  // MCP tools are registered as `${mcpToolName}_${serverName}`, so check
  // if the tool name ends with `_${mcpTool.toolName}` for MCP-type tools
  const mcpMatch = tools.find(
    (tool) =>
      tool.type === AgentToolType.MCP &&
      toolName.endsWith(`_${tool.toolName}`),
  );
  return mcpMatch;
}

function getToolMetadata({
  toolName,
  tools,
  baseTool,
}: GetToolMetadaParams): ToolCallContentBlock {
  const tool = findMatchingTool(toolName, tools);
  assertNotNullOrUndefined(tool, `Tool ${toolName} not found in agent tools: [${tools.map(t => t.toolName).join(', ')}]`);

  switch (tool.type) {
    case AgentToolType.PIECE: {
      const pieceMetadata = tool.pieceMetadata;
      assertNotNullOrUndefined(pieceMetadata, 'Piece metadata is required');
      return {
        ...baseTool,
        toolCallType: ToolCallType.PIECE,
        pieceName: pieceMetadata.pieceName,
        pieceVersion: pieceMetadata.pieceVersion,
        actionName: tool.pieceMetadata.actionName,
      };
    }
    case AgentToolType.FLOW: {
      assertNotNullOrUndefined(tool.externalFlowId, 'Flow ID is required');
      return {
        ...baseTool,
        toolCallType: ToolCallType.FLOW,
        displayName: tool.toolName,
        externalFlowId: tool.externalFlowId
      };
    }
    case AgentToolType.MCP: {
      assertNotNullOrUndefined(tool.serverUrl, 'Mcp server URL is required');
      // Extract the original MCP tool name from the composite key (e.g. "list_tickets_zendesk" -> "list_tickets")
      const mcpToolDisplayName = toolName.endsWith(`_${tool.toolName}`)
        ? toolName.slice(0, -(tool.toolName.length + 1))
        : toolName;
      return {
        ...baseTool,
        toolCallType: ToolCallType.MCP,
        displayName: mcpToolDisplayName,
        serverUrl: tool.serverUrl,
      };
    }
  }
}

type GetToolMetadaParams = {
    toolName: string;
    tools: AgentTool[];
    baseTool: ToolCallBase;
}