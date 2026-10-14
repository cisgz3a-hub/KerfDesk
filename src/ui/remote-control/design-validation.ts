import { z } from 'zod';
import { RemoteFault } from './fault';

// Renderer-side copy of the wire contract (electron/mcp/design-schemas.ts). The renderer never
// trusts that the relay or main process validated arguments.
const id = z.string().min(1).max(128);
const revision = z.string().min(1).max(200);
const coordinate = z.number().min(-100_000).max(100_000);
const size = z.number().positive().max(100_000);
const admission = { expectedRevision: revision, requestId: z.uuid() };
const placement = {
  xMm: coordinate.optional(),
  yMm: coordinate.optional(),
  widthMm: size.optional(),
};
const atLeastOne = (value: Record<string, unknown>) =>
  Object.values(value).some((field) => field !== undefined);

export const cncPatchSchema = z
  .strictObject({
    cutType: z
      .enum([
        'profile-outside',
        'profile-inside',
        'profile-on-path',
        'pocket',
        'engrave',
        'v-carve',
        'inlay-pair',
        'drill',
      ])
      .optional(),
    toolId: id.optional(),
    depthMm: z.number().min(0.05).max(200).optional(),
    depthPerPassMm: z.number().min(0.01).max(50).optional(),
    feedMmPerMin: z.number().min(1).max(100_000).optional(),
    plungeMmPerMin: z.number().min(1).max(100_000).optional(),
    spindleRpm: z.number().min(0).max(100_000).optional(),
    stepoverPercent: z.number().min(1).max(100).optional(),
    pocketStrategy: z.enum(['offset', 'raster-x', 'raster-y', 'adaptive']).optional(),
  })
  .refine(atLeastOne);
export const operationPatchSchema = z
  .strictObject({
    name: z.string().min(1).max(128).optional(),
    enabled: z.boolean().optional(),
    mode: z.enum(['line', 'fill', 'image']).optional(),
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
    cnc: cncPatchSchema.optional(),
  })
  .refine(atLeastOne);
export type RemoteOperationPatchFull = z.output<typeof operationPatchSchema>;
export type RemoteCncPatch = z.output<typeof cncPatchSchema>;

const createOperation = {
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/)
    .optional(),
  mode: z.enum(['line', 'fill', 'image']).optional(),
  name: z.string().min(1).max(128).optional(),
};
const svg = z.string().min(1).max(180_000);
/** A plain name: no path separators, reserved characters or control characters. */
function plainFileName(value: string): boolean {
  return Array.from(value).every(
    (character) => character.charCodeAt(0) >= 32 && !'\\/:*?"<>|'.includes(character),
  );
}
const artworkIds = z.array(id).min(1).max(200);

const designArgs = {
  create_operation: z.strictObject({ ...admission, ...createOperation }),
  assign_artwork_to_operation: z.strictObject({ ...admission, artworkIds, operationId: id }),
  reorder_operation: z.strictObject({
    ...admission,
    operationId: id,
    direction: z.enum(['up', 'down']),
  }),
  delete_operation: z.strictObject({ ...admission, operationId: id }),
  apply_material_recipe: z.strictObject({ ...admission, operationId: id, recipeId: id }),
  add_svg: z.strictObject({ ...admission, svg, ...placement }),
  import_file: z.strictObject({
    ...admission,
    fileName: z.string().min(1).max(128).refine(plainFileName),
    mimeType: z.enum(['image/svg+xml', 'image/png', 'image/jpeg', 'application/dxf']),
    dataBase64: z
      .string()
      .min(4)
      .max(240_000)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/)
      .refine((value) => value.length % 4 === 0),
    ...placement,
  }),
  save_project: z.strictObject(admission),
} as const;

/** Batch items: the existing single-edit argument shapes without admission fields. */
export const batchItemSchemas = {
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
      ({ pointsMm, closed }) =>
        new Set(pointsMm.map(({ xMm, yMm }) => `${xMm},${yMm}`)).size >= (closed ? 3 : 2),
    ),
  transform_artwork: z.strictObject({
    artworkIds,
    transform: z.discriminatedUnion('type', [
      z.strictObject({ type: z.literal('move'), dxMm: coordinate, dyMm: coordinate }),
      z.strictObject({ type: z.literal('resize'), widthMm: size, heightMm: size }),
      z.strictObject({ type: z.literal('rotate'), angleDeg: z.number().min(-36_000).max(36_000) }),
    ]),
  }),
  arrange_artwork: z.strictObject({
    artworkIds,
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
  update_operation: z.strictObject({ operationId: id, patch: operationPatchSchema }),
  create_operation: z.strictObject(createOperation),
  assign_artwork_to_operation: z.strictObject({ artworkIds, operationId: id }),
  apply_material_recipe: z.strictObject({ operationId: id, recipeId: id }),
  add_svg: z.strictObject({ svg, ...placement }),
} as const;
export type BatchCommand = keyof typeof batchItemSchemas;
export type BatchItem = { readonly command: BatchCommand; readonly args: Record<string, unknown> };

const batchItem = z.strictObject({
  command: z.enum(Object.keys(batchItemSchemas) as [BatchCommand, ...BatchCommand[]]),
  args: z.record(z.string(), z.unknown()),
});
const applyEdits = z.strictObject({ ...admission, edits: z.array(batchItem).min(1).max(40) });

export type DesignCommand = keyof typeof designArgs | 'apply_edits';
export const DESIGN_WRITE_COMMANDS = new Set<string>([...Object.keys(designArgs), 'apply_edits']);
type SingleDesignWrite = {
  [C in keyof typeof designArgs]: {
    readonly command: C;
    readonly args: z.output<(typeof designArgs)[C]>;
  };
}[keyof typeof designArgs];
export type DesignWrite =
  | SingleDesignWrite
  | {
      readonly command: 'apply_edits';
      readonly args: {
        readonly expectedRevision: string;
        readonly requestId: string;
        readonly edits: readonly BatchItem[];
      };
    };

export function validateDesignWrite(command: string, args: unknown): DesignWrite {
  if (command === 'apply_edits') {
    const parsed = applyEdits.safeParse(args);
    if (!parsed.success) throw new RemoteFault('invalid_arguments');
    const edits = parsed.data.edits.map((edit) => {
      const item = batchItemSchemas[edit.command].safeParse(edit.args);
      if (!item.success) throw new RemoteFault('invalid_arguments');
      return { command: edit.command, args: item.data as Record<string, unknown> };
    });
    return detach({ command, args: { ...parsed.data, edits } }) as DesignWrite;
  }
  if (!Object.hasOwn(designArgs, command)) throw new RemoteFault('unsupported_command');
  const parsed = designArgs[command as keyof typeof designArgs].safeParse(args);
  if (!parsed.success) throw new RemoteFault('invalid_arguments');
  return detach({ command, args: parsed.data }) as DesignWrite;
}

export function validOperationPatch(value: unknown): boolean {
  return operationPatchSchema.safeParse(value).success;
}

function detach<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
