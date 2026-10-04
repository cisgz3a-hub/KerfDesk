import { type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { MCP_ARRANGE_ACTIONS, mcpTextPatchSchema } from './authoring-schemas.js';

export const MCP_MAX_ITEMS = 200;
export const MCP_MAX_RESULT_BYTES = 256 * 1024;

const id = z.string().min(1).max(128);
const revision = z.string().min(1).max(200);
const coordinate = z.number().min(-100_000).max(100_000);
const size = z.number().positive().max(100_000);
const writeAdmission = { expectedRevision: revision, requestId: z.uuid() };
const artworkIds = z.array(id).max(MCP_MAX_ITEMS);
const operationPatch = z
  .strictObject({
    powerPercent: z.number().min(0).max(100).optional(),
    speedMmPerMin: z.number().positive().max(100_000).optional(),
    passes: z.number().int().min(1).max(1000).optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    'Provide at least one operation field.',
  );

export const mcpInputSchemas = {
  get_workspace: z.strictObject({}),
  get_machine: z.strictObject({}),
  get_app_status: z.strictObject({}),
  list_material_recipes: z.strictObject({}),
  review_job: z.strictObject({}),
  get_workspace_preview: z.strictObject({}),
  list_fonts: z.strictObject({}),
  get_text: z.strictObject({ artworkId: id }),
  set_selection: z.strictObject({ ...writeAdmission, artworkIds }),
  add_text: z.strictObject({
    ...writeAdmission,
    xMm: coordinate,
    yMm: coordinate,
    widthMm: size,
    text: z.string().min(1).max(4096),
    fontSizeMm: z.number().positive().max(1000),
    fontId: id.optional(),
  }),
  add_rectangle: z.strictObject({
    ...writeAdmission,
    xMm: coordinate,
    yMm: coordinate,
    widthMm: size,
    heightMm: size,
  }),
  transform_artwork: z.strictObject({
    ...writeAdmission,
    artworkIds: artworkIds.min(1),
    transform: z.discriminatedUnion('type', [
      z.strictObject({ type: z.literal('move'), dxMm: coordinate, dyMm: coordinate }),
      z.strictObject({ type: z.literal('resize'), widthMm: size, heightMm: size }),
      z.strictObject({ type: z.literal('rotate'), angleDeg: z.number().min(-36_000).max(36_000) }),
    ]),
  }),
  update_operation: z.strictObject({ ...writeAdmission, operationId: id, patch: operationPatch }),
  update_text: z.strictObject({ ...writeAdmission, artworkId: id, patch: mcpTextPatchSchema }),
  arrange_artwork: z.strictObject({
    ...writeAdmission,
    artworkIds: artworkIds.min(1),
    action: z.enum(MCP_ARRANGE_ACTIONS),
  }),
  undo: z.strictObject(writeAdmission),
  redo: z.strictObject(writeAdmission),
} as const;

export type KerfDeskMcpCommand = keyof typeof mcpInputSchemas;
export type KerfDeskMcpArgs<C extends KerfDeskMcpCommand> = z.output<(typeof mcpInputSchemas)[C]>;

/** One classification is used by the portable tools, relay and native admission checks. */
export const MCP_WRITE_COMMANDS = new Set<KerfDeskMcpCommand>(
  (Object.keys(mcpInputSchemas) as KerfDeskMcpCommand[]).filter((command) =>
    Object.hasOwn(mcpInputSchemas[command].shape, 'expectedRevision'),
  ),
);

/** Keep SDK validation errors bounded and avoid echoing untrusted arguments or object keys. */
export function mcpInputSchema<S extends z.ZodType>(
  schema: S,
): StandardSchemaWithJSON<z.input<S>, z.output<S>> {
  return {
    '~standard': {
      ...schema['~standard'],
      validate(value: unknown) {
        try {
          const parsed = schema.safeParse(value);
          if (parsed.success) return { value: parsed.data };
        } catch {
          // Native desktop arguments must be plain JSON, including in-process callers.
        }
        return { issues: [{ message: 'Invalid tool arguments.' }] };
      },
    },
  };
}
