// MachineConfig — which machine family the project targets. LaserForge began
// as a laser-only CAM; CNC (router/mill) support rides the same Scene and Job
// pipeline but compiles through core/cnc and emits through the CNC GRBL
// strategy. The config is part of Project so a .lf2 file round-trips the
// machine choice; projects without one are laser projects (back-compat).

import type { Vec2 } from './scene-object';

export type MachineKind = 'laser' | 'cnc';

export type CncToolKind = 'end-mill' | 'ball-nose' | 'v-bit' | 'engraving';

export type CncTool = {
  readonly id: string;
  readonly name: string;
  readonly kind: CncToolKind;
  readonly diameterMm: number;
  // v-bit / engraving tools only: included tip angle.
  readonly tipAngleDeg?: number;
};

// Stock (workpiece) parameters. Z0 is the stock TOP surface; cut depths are
// measured down from it. The XY footprint (Phase H.2) locates the workpiece
// on the bed: originOffset is the stock's min-XY corner in machine
// coordinates. Bed bounds remain the hard preflight error; toolpaths leaving
// the stock footprint are an advisory (clamps and offcuts are the operator's
// call).
export type CncStock = {
  readonly thicknessMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly originOffset: Vec2;
  // ADR-112: the job's stock material (a ChiploadMaterial key), chosen once in
  // the Material & Bit panel — Easel's project-level material. Drives the
  // project material picker that seeds/auto-fills every layer's feeds. Absent =
  // no project material ("Custom"); display/seed only, never compiled directly.
  readonly materialKey?: string;
};

// How a layer's geometry is machined (Easel's "cut type"):
//   profile-outside  — cut around the outside of closed shapes (part keeps size)
//   profile-inside   — cut inside closed shapes (hole keeps size)
//   profile-on-path  — cut centered on the path (open paths always use this)
//   pocket           — clear the interior of closed shapes
//   engrave          — trace the path itself, typically shallow
//   v-carve          — angled-bit variable-depth carve of closed shapes
//                      (Phase H.3, ADR-098): depth follows the local inset,
//                      z(d) = −min(d / tan(θ/2), depthMm)
//   relief-rough     — waterline roughing of a relief heightmap (H.5).
//                      COMPILE-TIME ONLY: produced from relief objects,
//                      never selectable on a layer (absent from
//                      CNC_CUT_TYPES, rejected by .lf2 normalization).
// H.9: which side of the travel direction the material sits on. With an M3
// spindle, climb keeps material on the LEFT of travel (see motion-polish).
export type CncCutDirection = 'climb' | 'conventional';

export type CncCutType =
  | 'profile-outside'
  | 'profile-inside'
  | 'profile-on-path'
  | 'pocket'
  | 'engrave'
  | 'v-carve'
  | 'drill'
  | 'relief-rough'
  // H.8 finishing skim over the true relief surface. COMPILE-TIME ONLY,
  // like relief-rough: produced when a relief layer has a finishing bit.
  | 'relief-finish';

export const CNC_CUT_TYPES: ReadonlyArray<CncCutType> = [
  'profile-outside',
  'profile-inside',
  'profile-on-path',
  'pocket',
  'engrave',
  'v-carve',
  'drill',
];

export type CncLayerSettings = {
  readonly cutType: CncCutType;
  // Multi-tool jobs (H.7): the bit this layer cuts with. Absent = the
  // machine's active bit. Unknown ids resolve to the active bit at compile
  // time (F-CNC1 edge: unknown tools are dropped).
  readonly toolId?: string;
  // Two-stage v-carve (H.7): flat floors beyond the v-bit's reach are
  // pocket-cleared with this bit first. Absent = single-stage v-carve.
  readonly vClearToolId?: string;
  // Relief finishing (H.8): the bit that skims the true surface after
  // roughing. Absent = roughing only (the part stays one allowance proud).
  readonly reliefFinishToolId?: string;
  // Ball-nose scallop height target driving the finishing row spacing.
  readonly reliefScallopMm?: number;
  // Motion polish (H.9), both opt-in — absent keeps pre-H.9 output:
  // descend into cuts along the path at this angle instead of plunging.
  readonly rampEntryDeg?: number;
  // Enforce climb or conventional cutting on profile/pocket toolpaths.
  readonly cutDirection?: CncCutDirection;
  // Total cut depth below stock top (positive). For v-carve this is the MAX
  // depth: wide regions clamp to it and cut a flat floor.
  readonly depthMm: number;
  readonly depthPerPassMm: number; // max material removed per Z pass (positive)
  // V-carve ring spacing (mm). 0 = auto (tool diameter / 8, floor 0.1 mm).
  // Smaller = finer walls, more rings, longer job.
  readonly vResolutionMm: number;
  readonly feedMmPerMin: number; // XY cutting feed
  readonly plungeMmPerMin: number; // Z plunge feed
  readonly spindleRpm: number; // S value; GRBL $30 should equal spindleMaxRpm
  readonly stepoverPercent: number; // pocket ring spacing as % of tool diameter
  // Pocket clearing strategy (ADR-105 G10). Absent = contour-parallel
  // offset rings (the original behavior, byte-identical).
  readonly pocketStrategy?: 'offset' | 'raster-x' | 'raster-y';
  // ADR-111: the material the feeds were auto-filled from (a ChiploadMaterial
  // key). Absent = feeds were entered manually ("Custom"). Display/round-trip
  // only — does not affect compiled output.
  readonly materialKey?: string;
  readonly tabsEnabled: boolean; // profile cuts only
  readonly tabHeightMm: number; // material left under a tab
  readonly tabWidthMm: number; // tab length along the path
  readonly tabsPerShape: number;
};

// Machine-wide flood/mist coolant for the whole CNC job (a router setting,
// not per-operation): mist → M7, flood → M8, off → no coolant command.
// Absent behaves exactly as 'off' (byte-identical output).
export type CncCoolantMode = 'off' | 'mist' | 'flood';

export const CNC_COOLANT_MODES: ReadonlyArray<CncCoolantMode> = ['off', 'mist', 'flood'];

export function isCncCoolantMode(value: unknown): value is CncCoolantMode {
  return CNC_COOLANT_MODES.some((mode) => mode === value);
}

export type CncMachineParams = {
  readonly safeZMm: number; // travel clearance above stock top
  readonly spindleMaxRpm: number; // GRBL $30 equivalent — max S value
  readonly spindleSpinupSec: number; // dwell after M3 before first plunge
  // Machine-wide coolant for the job. Absent = 'off' (no M7/M8/M9 emitted).
  readonly coolant?: CncCoolantMode;
  // H.9 parking parity: where the head parks after the job (and during
  // M0 bit changes). Absent = the machine origin, the pre-H.9 behavior.
  readonly parkXMm?: number;
  readonly parkYMm?: number;
};

export type LaserMachineConfig = { readonly kind: 'laser' };

// H.10 tiling: split jobs larger than the bed into an indexed tile grid
// with per-tile export and optional registration holes in the overlap
// strips. Absent = no tiling (single-file export, the default).
export type CncTiling = {
  readonly tileWidthMm: number;
  readonly tileHeightMm: number;
  readonly overlapMm: number;
  readonly registrationHoles: boolean;
};

export type CncMachineConfig = {
  readonly kind: 'cnc';
  readonly stock: CncStock;
  readonly tools: ReadonlyArray<CncTool>;
  readonly toolId: string; // active bit — one bit per job, like Easel
  readonly params: CncMachineParams;
  readonly tiling?: CncTiling;
};

export type MachineConfig = LaserMachineConfig | CncMachineConfig;

export const LASER_MACHINE_CONFIG: LaserMachineConfig = { kind: 'laser' };

// Starter bit library — common hobby-router bits. Names are mm-first with the
// imperial fraction the bit is physically sold by in parens, so an operator can
// match the bit in hand while the app stays metric. Diameters in mm. Existing
// ids are STABLE (referenced by .lf2 files, the default toolId, and tests) —
// only ever append here.
export const DEFAULT_CNC_TOOLS: ReadonlyArray<CncTool> = [
  { id: 'em-3175', name: '3.175 mm (1/8") end mill', kind: 'end-mill', diameterMm: 3.175 },
  { id: 'em-1588', name: '1.588 mm (1/16") end mill', kind: 'end-mill', diameterMm: 1.588 },
  { id: 'em-6350', name: '6.35 mm (1/4") end mill', kind: 'end-mill', diameterMm: 6.35 },
  { id: 'em-9525', name: '9.525 mm (3/8") end mill', kind: 'end-mill', diameterMm: 9.525 },
  { id: 'em-1000', name: '1 mm end mill', kind: 'end-mill', diameterMm: 1 },
  { id: 'em-2000', name: '2 mm end mill', kind: 'end-mill', diameterMm: 2 },
  { id: 'em-3000', name: '3 mm end mill', kind: 'end-mill', diameterMm: 3 },
  { id: 'em-6000', name: '6 mm end mill', kind: 'end-mill', diameterMm: 6 },
  { id: 'dc-3175', name: '3.175 mm (1/8") downcut end mill', kind: 'end-mill', diameterMm: 3.175 },
  { id: 'cp-6350', name: '6.35 mm (1/4") compression bit', kind: 'end-mill', diameterMm: 6.35 },
  { id: 'bn-3175', name: '3.175 mm (1/8") ball nose', kind: 'ball-nose', diameterMm: 3.175 },
  { id: 'bn-1588', name: '1.588 mm (1/16") ball nose', kind: 'ball-nose', diameterMm: 1.588 },
  { id: 'bn-6350', name: '6.35 mm (1/4") ball nose', kind: 'ball-nose', diameterMm: 6.35 },
  { id: 'vb-30', name: '30° V-bit', kind: 'v-bit', diameterMm: 3.175, tipAngleDeg: 30 },
  { id: 'vb-45', name: '45° V-bit', kind: 'v-bit', diameterMm: 6.35, tipAngleDeg: 45 },
  { id: 'vb-60', name: '60° V-bit', kind: 'v-bit', diameterMm: 6.35, tipAngleDeg: 60 },
  { id: 'vb-90', name: '90° V-bit', kind: 'v-bit', diameterMm: 12.7, tipAngleDeg: 90 },
  {
    id: 'eng-15',
    name: '15° engraving bit',
    kind: 'engraving',
    diameterMm: 3.175,
    tipAngleDeg: 15,
  },
];

// Footprint defaults sized to the 4040 target machine's 400 × 400 mm bed
// (ADR-098): a full-bed sheet at the machine origin until the operator says
// otherwise.
export const DEFAULT_CNC_STOCK: CncStock = {
  thicknessMm: 6.35,
  widthMm: 400,
  heightMm: 400,
  originOffset: { x: 0, y: 0 },
};

// Starter tiling block for the 4040 bed: near-full-bed tiles with a 20 mm
// registration overlap.
export const DEFAULT_CNC_TILING: CncTiling = {
  tileWidthMm: 380,
  tileHeightMm: 380,
  overlapMm: 20,
  registrationHoles: true,
};

export const DEFAULT_CNC_MACHINE_PARAMS: CncMachineParams = {
  safeZMm: 3.81, // Easel's 0.150 in safety height
  spindleMaxRpm: 12000,
  spindleSpinupSec: 3,
  coolant: 'off',
};

// Conservative wood/MDF starting point for a 1/8 in bit — same spirit as
// Easel's recommended settings.
export const DEFAULT_CNC_LAYER_SETTINGS: CncLayerSettings = {
  cutType: 'profile-outside',
  depthMm: 6.35,
  depthPerPassMm: 1.5,
  vResolutionMm: 0,
  feedMmPerMin: 1000,
  plungeMmPerMin: 300,
  spindleRpm: 12000,
  stepoverPercent: 40,
  tabsEnabled: false,
  tabHeightMm: 2,
  tabWidthMm: 6,
  tabsPerShape: 4,
};

export const DEFAULT_CNC_MACHINE_CONFIG: CncMachineConfig = {
  kind: 'cnc',
  stock: DEFAULT_CNC_STOCK,
  tools: DEFAULT_CNC_TOOLS,
  toolId: 'em-3175',
  params: DEFAULT_CNC_MACHINE_PARAMS,
};

// Ultimate fallback so activeCncTool is total even for a hand-edited .lf2
// with an empty tool list.
const FALLBACK_TOOL: CncTool = {
  id: 'em-3175',
  name: '3.175 mm (1/8") end mill',
  kind: 'end-mill',
  diameterMm: 3.175,
};

export function machineKindOf(machine: MachineConfig | undefined): MachineKind {
  return machine === undefined ? 'laser' : machine.kind;
}

export function activeCncTool(config: CncMachineConfig): CncTool {
  const found = config.tools.find((tool) => tool.id === config.toolId);
  return found ?? config.tools[0] ?? FALLBACK_TOOL;
}

// The bit a layer actually cuts with (H.7 multi-tool): its own toolId when
// set and known, the machine's active bit otherwise.
export function layerCncTool(
  config: CncMachineConfig,
  settings: Pick<CncLayerSettings, 'toolId'>,
): CncTool {
  if (settings.toolId !== undefined) {
    const found = config.tools.find((tool) => tool.id === settings.toolId);
    if (found !== undefined) return found;
  }
  return activeCncTool(config);
}

export function cutTypeLabel(cutType: CncCutType): string {
  switch (cutType) {
    case 'profile-outside':
      return 'Outline — outside path';
    case 'profile-inside':
      return 'Outline — inside path';
    case 'profile-on-path':
      return 'Outline — on path';
    case 'pocket':
      return 'Pocket (clear inside)';
    case 'engrave':
      return 'Engrave (trace path)';
    case 'v-carve':
      return 'V-carve (angled bit)';
    case 'drill':
      return 'Drill (peck at centers)';
    case 'relief-rough':
      return 'Relief roughing';
    case 'relief-finish':
      return 'Relief finishing';
  }
}
