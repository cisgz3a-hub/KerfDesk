// MachineConfig — which machine family the project targets. LaserForge began
// as a laser-only CAM; CNC (router/mill) support rides the same Scene and Job
// pipeline but compiles through core/cnc and emits through the CNC GRBL
// strategy. The config is part of Project so a .lf2 file round-trips the
// machine choice; projects without one are laser projects (back-compat).

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
// measured down from it. XY placement is governed by the bed bounds check.
export type CncStock = {
  readonly thicknessMm: number;
};

// How a layer's geometry is machined (Easel's "cut type"):
//   profile-outside  — cut around the outside of closed shapes (part keeps size)
//   profile-inside   — cut inside closed shapes (hole keeps size)
//   profile-on-path  — cut centered on the path (open paths always use this)
//   pocket           — clear the interior of closed shapes
//   engrave          — trace the path itself, typically shallow
export type CncCutType =
  | 'profile-outside'
  | 'profile-inside'
  | 'profile-on-path'
  | 'pocket'
  | 'engrave';

export const CNC_CUT_TYPES: ReadonlyArray<CncCutType> = [
  'profile-outside',
  'profile-inside',
  'profile-on-path',
  'pocket',
  'engrave',
];

export type CncLayerSettings = {
  readonly cutType: CncCutType;
  readonly depthMm: number; // total cut depth below stock top (positive)
  readonly depthPerPassMm: number; // max material removed per Z pass (positive)
  readonly feedMmPerMin: number; // XY cutting feed
  readonly plungeMmPerMin: number; // Z plunge feed
  readonly spindleRpm: number; // S value; GRBL $30 should equal spindleMaxRpm
  readonly stepoverPercent: number; // pocket ring spacing as % of tool diameter
  readonly tabsEnabled: boolean; // profile cuts only
  readonly tabHeightMm: number; // material left under a tab
  readonly tabWidthMm: number; // tab length along the path
  readonly tabsPerShape: number;
};

export type CncMachineParams = {
  readonly safeZMm: number; // travel clearance above stock top
  readonly spindleMaxRpm: number; // GRBL $30 equivalent — max S value
  readonly spindleSpinupSec: number; // dwell after M3 before first plunge
};

export type LaserMachineConfig = { readonly kind: 'laser' };

export type CncMachineConfig = {
  readonly kind: 'cnc';
  readonly stock: CncStock;
  readonly tools: ReadonlyArray<CncTool>;
  readonly toolId: string; // active bit — one bit per job, like Easel
  readonly params: CncMachineParams;
};

export type MachineConfig = LaserMachineConfig | CncMachineConfig;

export const LASER_MACHINE_CONFIG: LaserMachineConfig = { kind: 'laser' };

// Starter bit library — common hobby-router bits (Easel's default carving
// bits plus common metric end mills). Diameters in mm.
export const DEFAULT_CNC_TOOLS: ReadonlyArray<CncTool> = [
  { id: 'em-3175', name: '1/8 in straight end mill', kind: 'end-mill', diameterMm: 3.175 },
  { id: 'em-1588', name: '1/16 in straight end mill', kind: 'end-mill', diameterMm: 1.588 },
  { id: 'em-6350', name: '1/4 in straight end mill', kind: 'end-mill', diameterMm: 6.35 },
  { id: 'em-1000', name: '1 mm end mill', kind: 'end-mill', diameterMm: 1 },
  { id: 'em-2000', name: '2 mm end mill', kind: 'end-mill', diameterMm: 2 },
  { id: 'bn-3175', name: '1/8 in ball nose', kind: 'ball-nose', diameterMm: 3.175 },
  { id: 'vb-30', name: '30° engraving V-bit', kind: 'v-bit', diameterMm: 3.175, tipAngleDeg: 30 },
  { id: 'vb-60', name: '60° V-bit', kind: 'v-bit', diameterMm: 6.35, tipAngleDeg: 60 },
];

export const DEFAULT_CNC_STOCK: CncStock = { thicknessMm: 6.35 };

export const DEFAULT_CNC_MACHINE_PARAMS: CncMachineParams = {
  safeZMm: 3.81, // Easel's 0.150 in safety height
  spindleMaxRpm: 12000,
  spindleSpinupSec: 3,
};

// Conservative wood/MDF starting point for a 1/8 in bit — same spirit as
// Easel's recommended settings.
export const DEFAULT_CNC_LAYER_SETTINGS: CncLayerSettings = {
  cutType: 'profile-outside',
  depthMm: 6.35,
  depthPerPassMm: 1.5,
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
  name: '1/8 in straight end mill',
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
  }
}
