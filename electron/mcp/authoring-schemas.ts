import { z } from 'zod';
import { previewImageMatchesDimensions } from './preview-image.js';

export const MCP_ARRANGE_ACTIONS = [
  'align_left',
  'align_center',
  'align_right',
  'align_top',
  'align_middle',
  'align_bottom',
  'distribute_horizontal',
  'distribute_vertical',
  'mirror_horizontal',
  'mirror_vertical',
  'group',
  'ungroup',
  'duplicate',
  'delete',
] as const;

export const MCP_TEXT_FIELDS = [
  'text',
  'fontId',
  'fontSizeMm',
  'alignment',
  'lineHeight',
  'letterSpacing',
] as const;

const id = z.string().min(1).max(128);
const text = z.string().min(1).max(4096);
const alignment = z.enum(['left', 'center', 'right']);
const fontSizeMm = z.number().positive().max(1000);
const lineHeight = z.number().min(0.1).max(20);
const letterSpacing = z.number().min(-1).max(20);

export const mcpTextPatchSchema = z
  .strictObject({
    text: text.optional(),
    fontId: id.optional(),
    fontSizeMm: fontSizeMm.optional(),
    alignment: alignment.optional(),
    lineHeight: lineHeight.optional(),
    letterSpacing: letterSpacing.optional(),
  })
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    'Provide a text field.',
  );

export const mcpHistorySchema = z.object({ canUndo: z.boolean(), canRedo: z.boolean() });
export const mcpPermissionsSchema = z.object({
  canEdit: z.boolean(),
  artworkSharingEnabled: z.boolean(),
});

export const mcpAuthoringOutputSchemas = {
  list_fonts: z.object({
    revision: z.string().min(1).max(200),
    fonts: z
      .array(
        z.object({
          id,
          name: z.string().max(512),
          geometry: z.enum(['outline', 'single-line']),
          style: z.enum(['sans', 'serif', 'mono', 'script', 'display', 'stencil', 'single-line']),
        }),
      )
      .max(200),
    total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    truncated: z.boolean(),
  }),
  get_text: z.object({
    revision: z.string().min(1).max(200),
    artworkId: id,
    text,
    fontId: id,
    fontSizeMm,
    alignment,
    lineHeight,
    letterSpacing,
  }),
  get_workspace_preview: z
    .object({
      revision: z.string().min(1).max(200),
      status: z.enum(['ready', 'disabled', 'unavailable']),
      preview: z
        .object({
          mimeType: z.literal('image/png'),
          data: z
            .string()
            .min(1)
            .max(65_536)
            .regex(/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/)
            .refine((value) => value.length % 4 === 0),
          widthPx: z.number().int().positive().max(1024),
          heightPx: z.number().int().positive().max(1024),
        })
        .refine(previewImageMatchesDimensions)
        .optional(),
      bounds: z
        .object({
          xMm: z.number().min(-100_000).max(100_000),
          yMm: z.number().min(-100_000).max(100_000),
          widthMm: z.number().nonnegative().max(100_000),
          heightMm: z.number().nonnegative().max(100_000),
        })
        .optional(),
      message: z.string().max(2048).optional(),
    })
    .refine((result) => (result.status === 'ready') === (result.preview !== undefined)),
} as const;
