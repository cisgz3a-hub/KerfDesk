import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { type z } from 'zod';
import {
  type KerfDeskMcpBackend,
  KerfDeskMcpError,
  mcpErrorCode,
  mcpErrorMessages,
  requestMcpBackend,
} from './backend.js';
import {
  type KerfDeskMcpCommand,
  MCP_MAX_RESULT_BYTES,
  mcpInputSchema,
  mcpInputSchemas,
} from './input-schemas.js';
import { mcpOutputSchemas } from './output-schemas.js';
import { mcpToolAnnotations, mcpToolInfo } from './tool-info.js';

export type KerfDeskMcpToolMetadata = Partial<Record<KerfDeskMcpCommand, Record<string, unknown>>>;

function toolError(error: unknown): CallToolResult {
  const code = mcpErrorCode(error);
  return {
    isError: true,
    content: [{ type: 'text', text: mcpErrorMessages[code] }],
    structuredContent: { error: { code, message: mcpErrorMessages[code] } },
  };
}

function toolSuccess(command: KerfDeskMcpCommand, raw: Record<string, unknown>): CallToolResult {
  const output = mcpOutputSchemas[command].safeParse(raw);
  if (!output.success) throw new KerfDeskMcpError('failed');
  const result: CallToolResult = {
    content: [{ type: 'text', text: JSON.stringify(output.data) }],
    structuredContent: output.data,
  };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MCP_MAX_RESULT_BYTES) {
    throw new KerfDeskMcpError('failed');
  }
  return result;
}

async function callBackend(
  backend: KerfDeskMcpBackend,
  command: KerfDeskMcpCommand,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<CallToolResult> {
  try {
    const response = await requestMcpBackend(backend, command, args, signal);
    if (signal.aborted) throw new KerfDeskMcpError('cancelled');
    return toolSuccess(command, response);
  } catch (error) {
    return toolError(error);
  }
}

function registerTool(
  server: McpServer,
  backend: KerfDeskMcpBackend,
  command: KerfDeskMcpCommand,
  metadata?: Record<string, unknown>,
): void {
  // The concrete schemas also export typed args; this shared dispatcher accepts only their parsed objects.
  const input: z.ZodType<Record<string, unknown>> = mcpInputSchemas[command];
  server.registerTool(
    command,
    {
      ...mcpToolInfo[command],
      inputSchema: mcpInputSchema(input),
      outputSchema: mcpOutputSchemas[command],
      annotations: mcpToolAnnotations(command),
      ...(metadata === undefined ? {} : { _meta: metadata }),
    },
    (args, context) => callBackend(backend, command, args, context.mcpReq.signal),
  );
}

/** Build a fresh SDK server for a connected, authenticated desktop bridge. */
export function createKerfDeskMcpServer(
  backend: KerfDeskMcpBackend,
  toolMetadata: KerfDeskMcpToolMetadata = {},
): McpServer {
  const server = new McpServer(
    { name: 'kerfdesk-desktop', version: '1.0.0' },
    {
      capabilities: { tools: { listChanged: false } },
      instructions:
        'Tools read and edit the live desktop workspace. Read its revision before a write. The desktop remains responsible for licensing, Undo, request deduplication and operator review. Machine operation requires the normal desktop Frame and Start controls; no tool performs machine motion or output.',
    },
  );
  for (const command of Object.keys(mcpToolInfo) as KerfDeskMcpCommand[]) {
    registerTool(server, backend, command, toolMetadata[command]);
  }
  return server;
}
