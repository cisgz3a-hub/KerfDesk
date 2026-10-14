import { z } from 'zod';

const id = z.string().min(1).max(128);
const revision = z.string().min(1).max(200);
const coordinate = z.number().min(-100_000).max(100_000);
const size = z.number().positive().max(100_000);
const admission = { expectedRevision: revision, requestId: z.uuid() };
const color = z.string().regex(/^#[0-9a-f]{6}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const MCP_LASER_MODES = ['line', 'fill', 'image'] as const;
export const MCP_CNC_CUT_TYPES = [
  'profile-outside',
  'profile-inside',
  'profile-on-path',
  'pocket',
  'engrave',
  'v-carve',
  'inlay-pair',
  'drill',
] as const;
export const MCP_POCKET_STRATEGIES = ['offset', 'raster-x', 'raster-y', 'adaptive'] as const;
export const MCP_IMPORT_TYPES = [
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'application/dxf',
] as const;
/** Base64 of one bounded import; the whole command still fits the 256 KiB relay frame. */
export const MCP_IMPORT_BASE64_LIMIT = 240_000;
export const MCP_SVG_TEXT_LIMIT = 180_000;

/** A plain file name: no path separators, reserved characters or control characters. */
function plainFileName(value: string): boolean {
  return Array.from(value).every(
    (character) => character.charCodeAt(0) >= 32 && !'\\/:*?"<>|'.includes(character),
  );
}

export const mcpCncPatchSchema = z
  .strictObject({
    cutType: z.enum(MCP_CNC_CUT_TYPES).optional(),
    toolId: id.optional(),
    depthMm: z.number().min(0.05).max(200).optional(),
    depthPerPassMm: z.number().min(0.01).max(50).optional(),
    feedMmPerMin: z.number().min(1).max(100_000).optional(),
    plungeMmPerMin: z.number().min(1).max(100_000).optional(),
    spindleRpm: z.number().min(0).max(100_000).optional(),
    stepoverPercent: z.number().min(1).max(100).optional(),
    pocketStrategy: z.enum(MCP_POCKET_STRATEGIES).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), 'Provide a field.');

/** Ordinary operation fields the desktop already edits; Pro admission stays on the PC. */
export const mcpOperationPatchSchema = z
  .strictObject({
    name: z.string().min(1).max(128).optional(),
    enabled: z.boolean().optional(),
    mode: z.enum(MCP_LASER_MODES).optional(),
    powerPercent: z.number().min(0).max(100).optional(),
    minPowerPercent: z.number().min(0).max(100).optional(),
    speedMmPerMin: z.number().positive().max(100_000).optional(),
    passes: z.number().int().min(1).max(1000).optional(),
    airAssist: z.boolean().optional(),
    fillIntervalMm: z.number().min(0.01).max(10).optional(),
    fillAngleDeg: z.number().min(-360).max(360).optional(),
    fillBidirectional: z.boolean().optional(),
    fillCrossHatch: z.boolean().optional(),
    linesPerMm: z.number().min(1).max(100).optional(),
    negativeImage: z.boolean().optional(),
    cnc: mcpCncPatchSchema.optional(),
  })
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    'Provide at least one operation field.',
  );

const placement = {
  xMm: coordinate.optional(),
  yMm: coordinate.optional(),
  widthMm: size.optional(),
};
const createOperationArgs = {
  color: color.optional(),
  mode: z.enum(MCP_LASER_MODES).optional(),
  name: z.string().min(1).max(128).optional(),
};

/** Edits that `apply_edits` may combine. Arguments omit the shared admission fields. */
export const mcpBatchEditSchemas = {
  set_selection: z.strictObject({ artworkIds: z.array(id).max(200) }),
  add_text: z.strictObject({
    xMm: coordinate,
    yMm: coordinate,
    widthMm: size,
    text: z.string().min(1).max(4096),
    fontSizeMm: z.number().positive().max(1000),
    fontId: id.optional(),
  }),
  add_rectangle: z.strictObject({
    xMm: coordinate,
    yMm: coordinate,
    widthMm: size,
    heightMm: size,
  }),
  add_ellipse: z.strictObject({ xMm: coordinate, yMm: coordinate, widthMm: size, heightMm: size }),
  add_polyline: z
    .strictObject({
      pointsMm: z
        .array(z.strictObject({ xMm: coordinate, yMm: coordinate }))
        .min(2)
        .max(512),
      closed: z.boolean(),
    })
    .refine(
      (value) =>
        new Set(value.pointsMm.map((point) => `${point.xMm},${point.yMm}`)).size >=
        (value.closed ? 3 : 2),
      'Provide distinct drawing points.',
    ),
  transform_artwork: z.strictObject({
    artworkIds: z.array(id).min(1).max(200),
    transform: z.discriminatedUnion('type', [
      z.strictObject({ type: z.literal('move'), dxMm: coordinate, dyMm: coordinate }),
      z.strictObject({ type: z.literal('resize'), widthMm: size, heightMm: size }),
      z.strictObject({ type: z.literal('rotate'), angleDeg: z.number().min(-36_000).max(36_000) }),
    ]),
  }),
  arrange_artwork: z.strictObject({
    artworkIds: z.array(id).min(1).max(200),
    action: z.enum([
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
    ]),
  }),
  update_operation: z.strictObject({ operationId: id, patch: mcpOperationPatchSchema }),
  create_operation: z.strictObject(createOperationArgs),
  assign_artwork_to_operation: z.strictObject({
    artworkIds: z.array(id).min(1).max(200),
    operationId: id,
  }),
  apply_material_recipe: z.strictObject({ operationId: id, recipeId: id }),
  add_svg: z.strictObject({ svg: z.string().min(1).max(MCP_SVG_TEXT_LIMIT), ...placement }),
} as const;
export type McpBatchEditCommand = keyof typeof mcpBatchEditSchemas;
export const MCP_BATCH_EDIT_COMMANDS = Object.keys(mcpBatchEditSchemas) as McpBatchEditCommand[];

const batchEdit = z.discriminatedUnion(
  'command',
  MCP_BATCH_EDIT_COMMANDS.map((command) =>
    z.strictObject({ command: z.literal(command), args: mcpBatchEditSchemas[command] }),
  ) as unknown as [
    z.ZodObject<{ command: z.ZodLiteral<McpBatchEditCommand>; args: z.ZodType }>,
    ...z.ZodObject<{ command: z.ZodLiteral<McpBatchEditCommand>; args: z.ZodType }>[],
  ],
);

export const mcpDesignInputSchemas = {
  get_workspace_scene: z.strictObject({}),
  wait_for_change: z.strictObject({
    sinceRevision: revision.optional(),
    sinceMachineSeq: count.optional(),
    timeoutMs: z.number().int().min(0).max(15_000).optional(),
  }),
  create_operation: z.strictObject({ ...admission, ...createOperationArgs }),
  assign_artwork_to_operation: z.strictObject({
    ...admission,
    artworkIds: z.array(id).min(1).max(200),
    operationId: id,
  }),
  reorder_operation: z.strictObject({
    ...admission,
    operationId: id,
    direction: z.enum(['up', 'down']),
  }),
  delete_operation: z.strictObject({ ...admission, operationId: id }),
  apply_material_recipe: z.strictObject({ ...admission, operationId: id, recipeId: id }),
  add_svg: z.strictObject({
    ...admission,
    svg: z.string().min(1).max(MCP_SVG_TEXT_LIMIT),
    ...placement,
  }),
  import_file: z.strictObject({
    ...admission,
    fileName: z.string().min(1).max(128).refine(plainFileName),
    mimeType: z.enum(MCP_IMPORT_TYPES),
    dataBase64: z
      .string()
      .min(4)
      .max(MCP_IMPORT_BASE64_LIMIT)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/)
      .refine((value) => value.length % 4 === 0),
    ...placement,
  }),
  save_project: z.strictObject(admission),
  apply_edits: z.strictObject({ ...admission, edits: z.array(batchEdit).min(1).max(40) }),
} as const;

const viewportCoordinate = z.number().min(-200_000).max(200_000);
const sceneBounds = z.object({
  xMm: z.number().min(-100_000).max(100_000),
  yMm: z.number().min(-100_000).max(100_000),
  widthMm: z.number().nonnegative().max(100_000),
  heightMm: z.number().nonnegative().max(100_000),
});
/** Compact delta-encoded points in 0.01 mm: "x,y dx,dy dx,dy ..." (first pair absolute). */
const encodedPoints = z
  .string()
  .min(3)
  .max(200_000)
  .regex(/^-?\d+,-?\d+(?: -?\d+,-?\d+)*$/);

export const mcpSceneOutputSchema = z
  .object({
    revision,
    status: z.enum(['ready', 'disabled', 'unavailable']),
    message: z.string().max(2048).optional(),
    bed: z
      .object({
        widthMm: z.number().positive().max(100_000),
        heightMm: z.number().positive().max(100_000),
      })
      .optional(),
    extent: z
      .object({
        xMm: viewportCoordinate,
        yMm: viewportCoordinate,
        widthMm: z.number().positive().max(200_000),
        heightMm: z.number().positive().max(200_000),
      })
      .optional(),
    toleranceMm: z.number().nonnegative().max(1000).optional(),
    objects: z
      .array(
        z.object({
          id,
          kind: z.string().min(1).max(64),
          unitId: id,
          operationId: id.optional(),
          editable: z.boolean(),
          bounds: sceneBounds,
          paths: z
            .array(
              z.object({
                color,
                fill: z.boolean(),
                output: z.boolean(),
                polylines: z
                  .array(z.object({ closed: z.boolean(), points: encodedPoints }))
                  .max(4000),
              }),
            )
            .max(64),
        }),
      )
      .max(200)
      .optional(),
    images: z
      .array(
        z.object({
          id,
          unitId: id,
          editable: z.boolean(),
          corners: z.array(z.number().min(-100_000).max(100_000)).length(8),
        }),
      )
      .max(200)
      .optional(),
    totalObjects: count.optional(),
  })
  .refine(
    (value) =>
      value.status === 'ready' || (value.objects === undefined && value.images === undefined),
  );

const designWrite = z.object({
  revision,
  changedArtworkIds: z.array(id).max(200).optional(),
  selection: z.array(id).max(200).optional(),
  operationId: id.optional(),
  changedOperationIds: z.array(id).max(200).optional(),
  history: z.object({ canUndo: z.boolean(), canRedo: z.boolean() }).optional(),
  saved: z.boolean().optional(),
  message: z.string().max(2048).optional(),
});

export const mcpDesignOutputSchemas = {
  get_workspace_scene: mcpSceneOutputSchema,
  wait_for_change: z.object({
    revision,
    machineSeq: count,
    changed: z.boolean(),
    reason: z.enum(['workspace', 'machine', 'both', 'timeout', 'unsupported']),
  }),
  create_operation: designWrite,
  assign_artwork_to_operation: designWrite,
  reorder_operation: designWrite,
  delete_operation: designWrite,
  apply_material_recipe: designWrite,
  add_svg: designWrite,
  import_file: designWrite,
  save_project: designWrite,
  apply_edits: designWrite.extend({
    results: z
      .array(
        z.object({
          command: z.string().max(64),
          changedArtworkIds: z.array(id).max(200).optional(),
          operationId: id.optional(),
        }),
      )
      .max(40)
      .optional(),
  }),
} as const;
