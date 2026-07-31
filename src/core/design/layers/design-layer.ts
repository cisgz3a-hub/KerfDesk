// design-layer — the carve layer a sketch entity belongs to (ADR-272
// Amendment 1, DS-8). A DesignLayer is deliberately a SUBSET of
// CncLayerSettings: at Apply each design layer becomes one scene operation and
// these fields patch its `cnc` block, so the vocabulary must stay a projection
// of the shipped per-layer model (machine.ts:105), never a rival one.
//
// Ids are caller-supplied, like entity ids: pure core may not generate
// identity. Colors are scene DATA (they become operation colors at Apply and
// tint the sketch strokes), not chrome.

import type { CncCutType } from '../../scene';

// The operator-selectable subset. inlay-pair needs a linked pocket partner the
// Studio cannot express yet, and the relief-* kinds are compile-time only.
export type DesignCutType = Exclude<CncCutType, 'inlay-pair' | 'relief-rough' | 'relief-finish'>;

export type DesignLayer = {
  readonly id: string;
  readonly name: string;
  // Lowercase 6-digit presentation color, carried onto the scene operation.
  readonly color: string;
  readonly cutType: DesignCutType;
  // Total cut depth below stock top (positive). For v-carve this is the MAX
  // depth; at or past stock thickness the carve preview reads it as through.
  readonly depthMm: number;
  // The bit this layer cuts with. Absent = the machine's active bit, exactly
  // like CncLayerSettings.toolId (H.7 multi-tool).
  readonly toolId?: string;
  // Two-stage v-carve: flat floors beyond the v-bit's reach are pocket-cleared
  // with this bit first. Absent = single-stage v-carve.
  readonly vClearToolId?: string;
};

export const DESIGN_CUT_TYPES: ReadonlyArray<DesignCutType> = [
  'profile-outside',
  'profile-inside',
  'profile-on-path',
  'pocket',
  'engrave',
  'v-carve',
  'drill',
];

// Mirrors the main canvas defaults (ADR-256 profile-on-path, 1 mm) so a part
// designed without touching layer settings cuts like a drawn part does today.
export const DEFAULT_DESIGN_LAYER_ID = 'design-layer-1';

// Scene DATA: layer colors become operation colors at Apply, not chrome (ADR-047).
const DESIGN_LAYER_COLORS = [
  '#000000',
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#9333ea',
  '#ea580c',
  '#0891b2',
  '#c026d3',
  '#65a30d',
  '#4f46e5',
] as const;

export const DEFAULT_DESIGN_LAYER: DesignLayer = {
  id: DEFAULT_DESIGN_LAYER_ID,
  name: 'Layer 1',
  color: DESIGN_LAYER_COLORS[0],
  cutType: 'profile-on-path',
  depthMm: 1,
};

/** Color for the layer at `index`, cycling the palette past its end. */
export function designLayerColor(index: number): string {
  const safe = Number.isInteger(index) && index >= 0 ? index : 0;
  const color = DESIGN_LAYER_COLORS[safe % DESIGN_LAYER_COLORS.length];
  return color ?? DESIGN_LAYER_COLORS[0];
}

/**
 * A fresh layer for the given ordinal, named and colored by position.
 *
 * @param id Caller-minted id (the UI owns identity).
 * @param ordinal Zero-based position used for the name and palette color.
 */
export function createDesignLayer(id: string, ordinal: number): DesignLayer {
  return {
    id,
    name: `Layer ${ordinal + 1}`,
    color: designLayerColor(ordinal),
    cutType: DEFAULT_DESIGN_LAYER.cutType,
    depthMm: DEFAULT_DESIGN_LAYER.depthMm,
  };
}
