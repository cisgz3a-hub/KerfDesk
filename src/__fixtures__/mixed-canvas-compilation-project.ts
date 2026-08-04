import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type CncCutType,
  type Polyline,
  type Project,
  type SceneObject,
} from '../core/scene';

const OPERATIONS = [
  { id: 'script-vcarve', color: '#b91c1c', cutType: 'v-carve', toolId: 'vb-60' },
  { id: 'badge-vcarve', color: '#c2410c', cutType: 'v-carve', toolId: 'vb-60' },
  { id: 'pocket', color: '#047857', cutType: 'pocket', toolId: 'em-3175' },
  { id: 'engrave', color: '#0369a1', cutType: 'engrave', toolId: 'em-3175' },
  {
    id: 'profile-inside',
    color: '#4338ca',
    cutType: 'profile-inside',
    toolId: 'em-3175',
  },
  {
    id: 'profile-outside',
    color: '#7e22ce',
    cutType: 'profile-outside',
    toolId: 'em-3175',
  },
] as const satisfies ReadonlyArray<{
  readonly id: string;
  readonly color: string;
  readonly cutType: CncCutType;
  readonly toolId: string;
}>;

/** Representative G-code-viewer stress fixture: eight drawings across six operations. */
export function mixedCanvasCompilationProject(): Project {
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      objects: [
        scriptObject('script-drive', 'Drive', 12, 16),
        scriptObject('script-flourish', 'Flourish', 62, 16),
        vectorObject('vcarve-badge', 'badge-vcarve', 118, 16, 20),
        vectorObject('pocket-emblem', 'pocket', 12, 62, 24),
        vectorObject('pocket-slot', 'pocket', 54, 64, 28),
        vectorObject('engraved-mark', 'engrave', 102, 66, 20),
        vectorObject('inside-window', 'profile-inside', 142, 62, 24),
        vectorObject('outside-part', 'profile-outside', 184, 60, 28),
      ],
      layers: OPERATIONS.map((operation) => ({
        ...createLayer({ id: operation.id, color: operation.color }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: operation.cutType,
          toolId: operation.toolId,
          depthMm: operation.cutType === 'v-carve' ? 2 : 1,
          depthPerPassMm: 1,
          ...(operation.cutType === 'v-carve'
            ? { vCarveFlatDepthEnabled: true, vResolutionMm: 0.6 }
            : {}),
        },
      })),
    },
  };
}

function scriptObject(id: string, content: string, x: number, y: number): SceneObject {
  const operation = OPERATIONS[0];
  return {
    kind: 'text',
    id,
    content,
    fontKey: 'dancing-script-regular',
    sizeMm: 12,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: operation.color,
    operationIds: [operation.id],
    bounds: { minX: x, minY: y, maxX: x + 34, maxY: y + 16 },
    transform: IDENTITY_TRANSFORM,
    // Pre-rendered closed glyph regions keep the fixture independent of font
    // I/O while exercising the same multi-region V-carve boundary.
    paths: [
      {
        color: operation.color,
        polylines: [rectangle(x, y, 14, 14), rectangle(x + 12, y + 2, 20, 10)],
      },
    ],
  };
}

function vectorObject(
  id: string,
  operationId: (typeof OPERATIONS)[number]['id'],
  x: number,
  y: number,
  size: number,
): SceneObject {
  const operation = OPERATIONS.find((candidate) => candidate.id === operationId);
  if (operation === undefined) throw new Error(`Unknown mixed fixture operation ${operationId}`);
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    operationIds: [operationId],
    bounds: { minX: x, minY: y, maxX: x + size, maxY: y + size },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: operation.color, polylines: [rectangle(x, y, size, size)] }],
  };
}

function rectangle(x: number, y: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}
