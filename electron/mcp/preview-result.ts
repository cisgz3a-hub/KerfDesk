import { type CallToolResult } from '@modelcontextprotocol/server';
import { type z } from 'zod';
import type { mcpAuthoringOutputSchemas } from './authoring-schemas.js';

type PreviewResult = z.output<typeof mcpAuthoringOutputSchemas.get_workspace_preview>;

/** Keep pixels out of duplicate text content; ordinary MCP clients receive a standard image. */
export function workspacePreviewToolResult(result: PreviewResult): CallToolResult {
  const { preview, ...details } = result;
  return {
    structuredContent: result,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          ...details,
          ...(preview === undefined
            ? {}
            : {
                preview: {
                  mimeType: preview.mimeType,
                  widthPx: preview.widthPx,
                  heightPx: preview.heightPx,
                },
              }),
        }),
      },
      ...(preview === undefined
        ? []
        : [{ type: 'image' as const, data: preview.data, mimeType: preview.mimeType }]),
    ],
  };
}
