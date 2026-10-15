import { z } from 'zod';

// Renderer-owned copy of electron/mcp/selection-schemas.ts; never trust relay admission.
export const selectionArgsSchema = z
  .strictObject({
    mode: z.enum(['replace', 'add', 'remove', 'toggle', 'all', 'clear']).optional(),
    artworkIds: z
      .array(z.string().min(1).max(128))
      .max(200)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
  })
  .refine((value) =>
    value.mode === 'all' || value.mode === 'clear'
      ? (value.artworkIds?.length ?? 0) === 0
      : value.artworkIds !== undefined,
  );

export type RemoteSelectionArgs = z.output<typeof selectionArgsSchema>;
