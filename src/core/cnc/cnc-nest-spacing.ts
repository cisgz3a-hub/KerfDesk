// Nest spacing a CNC router needs between parts (ADR-433 Amendment 4, meta
// audit M7-P2-5). A profile that cuts on or outside a part's outline sweeps
// the bit up to one diameter past it, so parts packed closer than that bit
// cut into each other. The spacing is the widest such bit plus a margin,
// rounded up to the 0.1 mm the nest dialogs step by.

import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  outputOperationLayers,
  type CncCutType,
  type Project,
} from '../scene';

export const CNC_NEST_SPACING_MARGIN_MM = 1;

export type CncNestSpacing = {
  /** The widest bit cutting on or outside a part outline. */
  readonly bitDiameterMm: number;
  /** That bit's diameter plus the margin. */
  readonly spacingMm: number;
};

/** Null for a laser project, or one with no outline-freeing profile. */
export function cncNestSpacing(project: Pick<Project, 'machine' | 'scene'>): CncNestSpacing | null {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return null;
  let widestMm = 0;
  for (const layer of project.scene.layers.flatMap(outputOperationLayers)) {
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    if (!cutsOutsideOutline(settings.cutType)) continue;
    widestMm = Math.max(widestMm, layerCncTool(machine, settings).diameterMm);
  }
  if (!(widestMm > 0)) return null;
  return {
    bitDiameterMm: widestMm,
    spacingMm: Math.ceil((widestMm + CNC_NEST_SPACING_MARGIN_MM) * 10 - 1e-9) / 10,
  };
}

function cutsOutsideOutline(cutType: CncCutType): boolean {
  return cutType === 'profile-outside' || cutType === 'profile-on-path';
}
