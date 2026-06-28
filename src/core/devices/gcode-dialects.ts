export type GrblGcodeDialectId =
  | 'grbl-compatible'
  | 'grbl-dynamic'
  | 'grbl-raster'
  | 'neotronics-4040-safe';

export type GcodeDialectSelection = {
  readonly dialectId: GrblGcodeDialectId;
};

export type GrblPowerMode = 'constant' | 'dynamic';

export type GrblGcodeDialect = {
  readonly id: GrblGcodeDialectId;
  readonly label: string;
  readonly description: string;
  readonly cutPowerMode: GrblPowerMode;
  readonly fillPowerMode: GrblPowerMode;
  readonly rasterPowerMode: GrblPowerMode;
  readonly requiresS0OnRapid: boolean;
  readonly parkAtOriginAfterJob: boolean;
  readonly controlledLaserOffTravelFeedMmPerMin?: number;
  readonly emitSOnEveryBurnMove: boolean;
  readonly modalFeedrate: boolean;
};

const DEFAULT_DIALECT_ID: GrblGcodeDialectId = 'grbl-dynamic';

const GRBL_DYNAMIC_DIALECT: GrblGcodeDialect = {
  id: 'grbl-dynamic',
  label: 'GRBL Dynamic',
  description: 'KerfDesk default: constant-power cuts, dynamic fill and raster sweeps.',
  cutPowerMode: 'constant',
  fillPowerMode: 'dynamic',
  rasterPowerMode: 'dynamic',
  requiresS0OnRapid: true,
  parkAtOriginAfterJob: true,
  emitSOnEveryBurnMove: false,
  modalFeedrate: true,
};

export const GRBL_GCODE_DIALECTS: ReadonlyArray<GrblGcodeDialect> = [
  {
    id: 'grbl-compatible',
    label: 'GRBL Compatible',
    description: 'Conservative GRBL v1.1 output with constant-power vector cuts.',
    cutPowerMode: 'constant',
    fillPowerMode: 'dynamic',
    rasterPowerMode: 'dynamic',
    requiresS0OnRapid: true,
    parkAtOriginAfterJob: true,
    emitSOnEveryBurnMove: false,
    modalFeedrate: true,
  },
  GRBL_DYNAMIC_DIALECT,
  {
    id: 'grbl-raster',
    label: 'GRBL Raster',
    description: 'GRBL dynamic raster behavior for image-heavy jobs.',
    cutPowerMode: 'constant',
    fillPowerMode: 'dynamic',
    rasterPowerMode: 'dynamic',
    requiresS0OnRapid: true,
    parkAtOriginAfterJob: true,
    emitSOnEveryBurnMove: false,
    modalFeedrate: true,
  },
  {
    id: 'neotronics-4040-safe',
    label: 'Neotronics 4040 Safe',
    description: 'Conservative GRBL dialect for the Neotronics 4040 profile family.',
    cutPowerMode: 'constant',
    fillPowerMode: 'dynamic',
    rasterPowerMode: 'dynamic',
    requiresS0OnRapid: true,
    parkAtOriginAfterJob: false,
    controlledLaserOffTravelFeedMmPerMin: 800,
    emitSOnEveryBurnMove: true,
    modalFeedrate: false,
  },
];

export function resolveGrblDialect(device: {
  readonly gcodeDialect?: { readonly dialectId?: string };
}): GrblGcodeDialect {
  const dialectId = device.gcodeDialect?.dialectId ?? DEFAULT_DIALECT_ID;
  return GRBL_GCODE_DIALECTS.find((dialect) => dialect.id === dialectId) ?? GRBL_DYNAMIC_DIALECT;
}

export function normalizeGcodeDialectSelection(value: unknown): GcodeDialectSelection {
  if (isGcodeDialectSelection(value)) return { dialectId: value.dialectId };
  return { dialectId: DEFAULT_DIALECT_ID };
}

export function isGcodeDialectSelection(value: unknown): value is GcodeDialectSelection {
  if (!isRecord(value)) return false;
  return isGrblGcodeDialectId(value['dialectId']);
}

export function isGrblGcodeDialectId(value: unknown): value is GrblGcodeDialectId {
  return GRBL_GCODE_DIALECTS.some((dialect) => dialect.id === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
