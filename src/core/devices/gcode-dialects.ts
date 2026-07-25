export type GrblGcodeDialectId =
  | 'grbl-compatible'
  | 'grbl-dynamic'
  | 'grbl-raster'
  | 'neotronics-4040-safe';

// Marlin output dialects (ADR-095): 'marlin-inline' assumes LASER_FEATURE
// (M3/M4/M5 + per-move S, same wire shape as GRBL with maxPowerS=255);
// 'marlin-fan' drives a fan-mosfet laser with M106 Sn / M107 power changes
// between moves (no per-move S support at all).
export type MarlinGcodeDialectId = 'marlin-inline' | 'marlin-fan';

export type GcodeDialectId = GrblGcodeDialectId | MarlinGcodeDialectId;

export type GcodeDialectSelection = {
  readonly dialectId: GcodeDialectId;
};

export type MarlinPowerMode = 'inline' | 'fan';

export type MarlinGcodeDialect = {
  readonly id: MarlinGcodeDialectId;
  readonly label: string;
  readonly description: string;
  readonly powerMode: MarlinPowerMode;
};

export const MARLIN_GCODE_DIALECTS: ReadonlyArray<MarlinGcodeDialect> = [
  {
    id: 'marlin-inline',
    label: 'Marlin Inline (LASER_FEATURE)',
    description: 'Marlin builds with LASER_FEATURE: M3/M4/M5 with per-move S power, S range 0-255.',
    powerMode: 'inline',
  },
  {
    id: 'marlin-fan',
    label: 'Marlin Fan-mosfet',
    description:
      'Laser wired to the part-cooling fan output: power via M106 Sn / M107 between moves. Raster is slow and coarse in this mode.',
    powerMode: 'fan',
  },
];

const DEFAULT_MARLIN_DIALECT = MARLIN_GCODE_DIALECTS[0] as MarlinGcodeDialect;

export function resolveMarlinDialect(device: {
  readonly gcodeDialect?: { readonly dialectId?: string };
}): MarlinGcodeDialect {
  const dialectId = device.gcodeDialect?.dialectId;
  return (
    MARLIN_GCODE_DIALECTS.find((dialect) => dialect.id === dialectId) ?? DEFAULT_MARLIN_DIALECT
  );
}

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
  readonly emitSOnEveryBurnMove: boolean;
  readonly modalFeedrate: boolean;
};

const DEFAULT_DIALECT_ID: GrblGcodeDialectId = 'grbl-dynamic';

const GRBL_DYNAMIC_DIALECT: GrblGcodeDialect = {
  id: 'grbl-dynamic',
  label: 'GRBL Dynamic',
  description: 'KerfDesk default: dynamic-power cuts, fill and raster sweeps.',
  // ADR-257: vector cuts default to M4 dynamic power. Under M3 the head burns at
  // full programmed S while accelerating out of a corner, depositing more energy per
  // mm exactly where it moves slowest — the scorched-corner defect. GRBL's own
  // laser_mode doc says M3 needs added lead-in/lead-out motions "for a clean cut and
  // prevent scorching", which our default profiles do not emit (ADR-239 entry runways
  // are 4040-scoped). M4 scales S by actual/programmed feed instead, so energy per mm
  // stays flat through the corner, and the beam is dark whenever motion stops.
  cutPowerMode: 'dynamic',
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
    // ADR-257 deliberately leaves this one constant: it is the escape hatch for
    // firmware without dynamic power (GRBL 1.1e and older, where M4 does not exist),
    // mirroring LightBurn's separate "GRBL-M3" device profile for the same firmware.
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
    // ADR-257: a dynamic-oriented dialect keeps dynamic cuts too. Rayforge's
    // equivalent grbl_raster dialect holds M4 active across the whole job.
    cutPowerMode: 'dynamic',
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
    emitSOnEveryBurnMove: true,
    modalFeedrate: false,
  },
];

export function resolveGrblDialect(device: {
  readonly gcodeDialect?: { readonly dialectId?: string };
}): GrblGcodeDialect {
  const dialectId = device.gcodeDialect?.dialectId ?? DEFAULT_DIALECT_ID;
  if (isMarlinGcodeDialectId(dialectId)) return GRBL_DYNAMIC_DIALECT;
  const dialect = GRBL_GCODE_DIALECTS.find((candidate) => candidate.id === dialectId);
  if (dialect === undefined) {
    throw new Error(`Unknown GRBL G-code dialect: ${dialectId}`);
  }
  return dialect;
}

export function normalizeGcodeDialectSelection(value: unknown): GcodeDialectSelection {
  if (isGcodeDialectSelection(value)) return { dialectId: value.dialectId };
  return { dialectId: DEFAULT_DIALECT_ID };
}

export function isGcodeDialectSelection(value: unknown): value is GcodeDialectSelection {
  if (!isRecord(value)) return false;
  return isGcodeDialectId(value['dialectId']);
}

export function isGcodeDialectId(value: unknown): value is GcodeDialectId {
  return isGrblGcodeDialectId(value) || isMarlinGcodeDialectId(value);
}

export function isGrblGcodeDialectId(value: unknown): value is GrblGcodeDialectId {
  return GRBL_GCODE_DIALECTS.some((dialect) => dialect.id === value);
}

export function isMarlinGcodeDialectId(value: unknown): value is MarlinGcodeDialectId {
  return MARLIN_GCODE_DIALECTS.some((dialect) => dialect.id === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
