import { type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { MCP_ARRANGE_ACTIONS, mcpTextPatchSchema } from './authoring-schemas.js';
import { mcpMachineInputSchemas } from './machine-schemas.js';
import { mcpDesignInputSchemas, mcpOperationPatchSchema } from './design-schemas.js';
import { mcpSelectionFields, validSelectionFields } from './selection-schemas.js';

export const MCP_MAX_ITEMS = 200;
export const MCP_MAX_RESULT_BYTES = 256 * 1024;

const id = z.string().min(1).max(128);
const revision = z.string().min(1).max(200);
const coordinate = z.number().min(-100_000).max(100_000);
const size = z.number().positive().max(100_000);
const writeAdmission = { expectedRevision: revision, requestId: z.uuid() };
const artworkIds = z.array(id).max(MCP_MAX_ITEMS);
const pointsMm = z
  .array(z.strictObject({ xMm: coordinate, yMm: coordinate }))
  .min(2)
  .max(512);
const operationPatch = mcpOperationPatchSchema;

export const mcpInputSchemas = {
  get_workspace: z.strictObject({}),
  get_machine: z.strictObject({}),
  get_app_status: z.strictObject({}),
  list_material_recipes: z.strictObject({}),
  review_job: z.strictObject({}),
  get_workspace_preview: z.strictObject({}),
  list_fonts: z.strictObject({}),
  get_text: z.strictObject({ artworkId: id }),
  set_selection: z
    .strictObject({ ...writeAdmission, ...mcpSelectionFields })
    .refine(validSelectionFields, 'Provide artworkIds, or use all/clear without target IDs.'),
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
  add_ellipse: z.strictObject({
    ...writeAdmission,
    xMm: coordinate,
    yMm: coordinate,
    widthMm: size,
    heightMm: size,
  }),
  add_polyline: z
    .strictObject({ ...writeAdmission, pointsMm, closed: z.boolean() })
    .refine(
      (value) =>
        new Set(value.pointsMm.map((point) => `${point.xMm},${point.yMm}`)).size >=
        (value.closed ? 3 : 2),
      'Provide distinct drawing points.',
    ),
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
  ...mcpDesignInputSchemas,
  ...mcpMachineInputSchemas,
} as const;

export type KerfDeskMcpCommand = keyof typeof mcpInputSchemas;
export type KerfDeskMcpArgs<C extends KerfDeskMcpCommand> = z.output<(typeof mcpInputSchemas)[C]>;

/** One classification is used by the portable tools, relay and native admission checks. */
export const MCP_WRITE_COMMANDS = new Set<KerfDeskMcpCommand>([
  'set_selection',
  'add_text',
  'add_rectangle',
  'add_ellipse',
  'add_polyline',
  'transform_artwork',
  'update_operation',
  'update_text',
  'arrange_artwork',
  'undo',
  'redo',
  'create_operation',
  'assign_artwork_to_operation',
  'reorder_operation',
  'delete_operation',
  'apply_material_recipe',
  'add_svg',
  'import_file',
  'save_project',
  'apply_edits',
]);

/** Physical control is independent of document editing, including revision-bearing controls. */
export const MCP_CONTROL_COMMANDS = new Set<KerfDeskMcpCommand>([
  'jog_machine',
  'frame_job',
  'review_machine_job',
  'start_job',
  'abort_job',
  'connect_machine',
  'disconnect_machine',
  'home_machine',
  'set_work_origin',
  'pause_job',
  'resume_job',
  'jog_hold_start',
  'jog_hold_stop',
]);

/** Control-approved reads that are not ledgered actions (no requestId, no motion). */
export const MCP_CONTROL_READ_COMMANDS = new Set<KerfDeskMcpCommand>(['get_camera_snapshot']);

/** Stop/cancel commands share the reserved Abort lane: they must stay reachable under load. */
export const MCP_PRIORITY_COMMANDS = new Set<KerfDeskMcpCommand>(['abort_job', 'jog_hold_stop']);

/** Held motion needs a live phone socket for its dead-man heartbeat; never offered to AI tools. */
export const MCP_PHONE_ONLY_COMMANDS = new Set<KerfDeskMcpCommand>([
  'jog_hold_start',
  'jog_hold_stop',
]);

/** Answered by the relay from desktop change counters; the desktop never receives it. */
export const MCP_RELAY_COMMANDS = new Set<KerfDeskMcpCommand>(['wait_for_change']);

export function mcpCommandScope(command: KerfDeskMcpCommand): 'read' | 'edit' | 'control' {
  if (MCP_CONTROL_COMMANDS.has(command) || MCP_CONTROL_READ_COMMANDS.has(command)) return 'control';
  return MCP_WRITE_COMMANDS.has(command) ? 'edit' : 'read';
}

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
