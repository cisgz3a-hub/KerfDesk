import { type CallToolResult } from '@modelcontextprotocol/server';
import { type z } from 'zod';
import type { mcpAuthoringOutputSchemas } from './authoring-schemas.js';
import type { mcpMachineOutputSchemas } from './machine-schemas.js';

type PreviewResult = z.output<typeof mcpAuthoringOutputSchemas.get_workspace_preview>;
type CameraResult = z.output<typeof mcpMachineOutputSchemas.get_camera_snapshot>;

/** Keep pixels out of duplicate text content; ordinary MCP clients receive a standard image. */
export function workspacePreviewToolResult(result: PreviewResult): CallToolResult {
  const { preview, ...details } = result;
  return imageToolResult(result, details, 'preview', preview);
}

/** Camera stills need a standard image block for hosts to pass pixels to the model. */
export function cameraSnapshotToolResult(result: CameraResult): CallToolResult {
  const { image, ...details } = result;
  return imageToolResult(result, details, 'image', image);
}

function imageToolResult(
  result: Record<string, unknown>,
  details: Record<string, unknown>,
  key: 'preview' | 'image',
  image: PreviewResult['preview'] | CameraResult['image'],
): CallToolResult {
  return {
    structuredContent: result,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          ...details,
          ...(image === undefined
            ? {}
            : {
                [key]: {
                  mimeType: image.mimeType,
                  widthPx: image.widthPx,
                  heightPx: image.heightPx,
                },
              }),
        }),
      },
      ...(image === undefined
        ? []
        : [{ type: 'image' as const, data: image.data, mimeType: image.mimeType }]),
    ],
  };
}
