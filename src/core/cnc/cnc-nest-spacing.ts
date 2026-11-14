// Nest spacing a CNC router needs between parts (ADR-433 Amendment 4, meta
// audit M7-P2-5). A profile that cuts on or outside a part's outline sweeps
// the bit up to one diameter past it, so parts packed closer than that bit
// cut into each other. The spacing is the widest such bit plus a margin,
// rounded up to the 0.1 mm the nest dialogs step by.
//
// An Outside profile's lead (ADR-250, default on) plunges in the waste beyond
// the cut, so the gap must also hold the lead's reach, or the facing edge's
// lead is refused and the bit plunges on the cut line (CNC audit v3
// N4-P3-2). The default 1/8" arc lead needs a radius more: 4.2 mm became 5.8.

import { resolveProfileLeadOptions } from './profile-lead-passes';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  outputOperationLayers,
  type CncCutType,
  type CncLayerSettings,
  type Project,
} from '../scene';

export const CNC_NEST_SPACING_MARGIN_MM = 1;
const DEG_TO_RAD = Math.PI / 180;
const MAX_LEAD_SWEEP_DEG = 180;
const DEFAULT_LEAD_SWEEP_DEG = 90;

export type CncNestSpacing = {
  /** The widest bit cutting on or outside a part outline. */
  readonly bitDiameterMm: number;
  /** How far the widest lead reaches past its cut line into the gap (0 without leads). */
  readonly leadReachMm: number;
  /** The widest bit plus its lead's reach plus the margin. */
  readonly spacingMm: number;
};

/** Null for a laser project, or one with no outline-freeing profile. */
export function cncNestSpacing(project: Pick<Project, 'machine' | 'scene'>): CncNestSpacing | null {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return null;
  let widest = { bitDiameterMm: 0, leadReachMm: 0 };
  for (const layer of project.scene.layers.flatMap(outputOperationLayers)) {
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    if (!cutsOutsideOutline(settings.cutType)) continue;
    const bitDiameterMm = layerCncTool(machine, settings).diameterMm;
    const leadReachMm = leadReach(settings, bitDiameterMm);
    if (bitDiameterMm + leadReachMm > widest.bitDiameterMm + widest.leadReachMm) {
      widest = { bitDiameterMm, leadReachMm };
    }
  }
  if (!(widest.bitDiameterMm > 0)) return null;
  const neededMm = widest.bitDiameterMm + widest.leadReachMm + CNC_NEST_SPACING_MARGIN_MM;
  return { ...widest, spacingMm: Math.ceil(neededMm * 10 - 1e-9) / 10 };
}

function cutsOutsideOutline(cutType: CncCutType): boolean {
  return cutType === 'profile-outside' || cutType === 'profile-on-path';
}

// How far an Outside lead's plunge sits beyond the cut line: a line lead its
// length, an arc lead r(1 - cos sweep) (the radius for the default quarter
// turn, up to twice it for a half turn). On-path cuts carry no lead.
function leadReach(settings: CncLayerSettings, bitDiameterMm: number): number {
  if (settings.cutType !== 'profile-outside') return 0;
  const lead = resolveProfileLeadOptions(settings.profileLead, bitDiameterMm);
  if (lead === null) return 0;
  if (lead.shape === 'line') return lead.radiusMm;
  const sweep = Math.min(MAX_LEAD_SWEEP_DEG, lead.sweepDeg ?? DEFAULT_LEAD_SWEEP_DEG);
  return lead.radiusMm * (1 - Math.cos(sweep * DEG_TO_RAD));
}
