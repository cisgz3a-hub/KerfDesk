// probe-form-store — the touch-plate probe form, shared by every surface that
// hosts ProbeControls.
//
// The controls are mounted in three places (the CNC Material & Bit rail, the
// Device-Setup wizard step, and ProbePanel). Holding the form in component
// state gave each mount its own private copy: plate offsets and probe depths
// dialled in the wizard were absent from the rail, and the rail's Run then
// used stale defaults. For a touch plate that is a real-machine hazard — the
// numbers decide where Z zero lands — so the form lives in one store instead.
//
// Ephemeral like ui-store: not project data, never undoable.

import { create } from 'zustand';
import {
  DEFAULT_PLATE_CENTER_OFFSET_X_MM,
  DEFAULT_PLATE_CENTER_OFFSET_Y_MM,
  DEFAULT_SIDE_CLEARANCE_MM,
  DEFAULT_SIDE_DROP_MM,
  DEFAULT_Z_PROBE_PARAMS,
  type ProbeCorner,
  type ZProbeParams,
} from '../../core/controllers/grbl';
import type { CornerProbeGeometryDraft } from './CornerProbeGeometryFields';

export type ProbeMode = 'z' | 'corner';

export const DEFAULT_CORNER_PROBE_GEOMETRY: CornerProbeGeometryDraft = {
  plateCenterOffsetXmm: DEFAULT_PLATE_CENTER_OFFSET_X_MM,
  plateCenterOffsetYmm: DEFAULT_PLATE_CENTER_OFFSET_Y_MM,
  sideDropMm: DEFAULT_SIDE_DROP_MM,
  sideClearanceMm: DEFAULT_SIDE_CLEARANCE_MM,
};

export type ProbeFormState = {
  readonly mode: ProbeMode;
  readonly corner: ProbeCorner;
  readonly zParams: ZProbeParams;
  /** Operator override; null follows the machine's active bit. */
  readonly bitDiameterMm: number | null;
  /** Identity of the bit the override was typed against, so a bit change releases it. */
  readonly bitDiameterToolId: string | null;
  readonly cornerGeometry: CornerProbeGeometryDraft;
  readonly setMode: (mode: ProbeMode) => void;
  readonly setCorner: (corner: ProbeCorner) => void;
  readonly setZParams: (params: ZProbeParams) => void;
  readonly setBitDiameterMm: (value: number, toolId: string) => void;
  readonly setCornerGeometry: (value: CornerProbeGeometryDraft) => void;
};

export const useProbeFormStore = create<ProbeFormState>((set) => ({
  mode: 'z',
  corner: 'front-left',
  zParams: DEFAULT_Z_PROBE_PARAMS,
  bitDiameterMm: null,
  bitDiameterToolId: null,
  cornerGeometry: DEFAULT_CORNER_PROBE_GEOMETRY,
  setMode: (mode) => set({ mode }),
  setCorner: (corner) => set({ corner }),
  setZParams: (zParams) => set({ zParams }),
  setBitDiameterMm: (bitDiameterMm, bitDiameterToolId) => set({ bitDiameterMm, bitDiameterToolId }),
  setCornerGeometry: (cornerGeometry) => set({ cornerGeometry }),
}));

/**
 * The diameter the probe should actually use. An override applies only while
 * the bit it was typed against is still active — swapping bits re-follows the
 * machine, instead of silently probing with the previous cutter's diameter.
 */
export function effectiveProbeBitDiameterMm(
  form: Pick<ProbeFormState, 'bitDiameterMm' | 'bitDiameterToolId'>,
  activeToolId: string,
  activeToolDiameterMm: number,
): number {
  return form.bitDiameterMm !== null && form.bitDiameterToolId === activeToolId
    ? form.bitDiameterMm
    : activeToolDiameterMm;
}
