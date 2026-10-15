import { z } from 'zod';

export const mcpSelectionFields = {
  mode: z.enum(['replace', 'add', 'remove', 'toggle', 'all', 'clear']).optional(),
  artworkIds: z
    .array(z.string().min(1).max(128))
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, 'Artwork IDs must be unique.')
    .optional(),
};

export function validSelectionFields(value: {
  mode?: string | undefined;
  artworkIds?: readonly string[] | undefined;
}): boolean {
  return value.mode === 'all' || value.mode === 'clear'
    ? (value.artworkIds?.length ?? 0) === 0
    : value.artworkIds !== undefined;
}

export const mcpSelectionArgsSchema = z
  .strictObject(mcpSelectionFields)
  .refine(validSelectionFields, 'Provide artworkIds, or use all/clear without target IDs.');
