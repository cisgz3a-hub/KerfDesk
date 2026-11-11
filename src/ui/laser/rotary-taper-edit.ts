// Taper edits for Rotary Setup (ADR-694; LightBurn's Taper Warp). While the
// taper is on, Object diameter follows the wider end, as LightBurn asks
// ("use the largest diameter"): a chuck's output does not depend on it, and a
// roller drives a tapered part at its wider end once the side being engraved
// is level. Turning the taper off keeps its measurements for next time.

import type { RotarySetup, RotaryTaper } from '../../core/devices/rotary';
import type { RotaryEdit } from './rotary-setup-edit';

// A tumbler-sized starting length, for the operator to replace.
export const DEFAULT_TAPER_LENGTH_MM = 100;

export type RotaryTaperPatch = Partial<Omit<RotaryTaper, 'enabled'>>;

/** A new taper starts as a straight part of the current diameter: no warp
 * until the operator enters the two ends. */
export function newRotaryTaper(setup: RotarySetup): RotaryTaper {
  return {
    enabled: true,
    topDiameterMm: setup.objectDiameterMm,
    bottomDiameterMm: setup.objectDiameterMm,
    lengthMm: DEFAULT_TAPER_LENGTH_MM,
    topSide: 'left',
    artworkFromTopMm: 0,
  };
}

export function editTaperEnabled(edit: RotaryEdit, enabled: boolean): RotaryEdit {
  const current = edit.setup.taper;
  if (!enabled) {
    return current === undefined || !current.enabled
      ? edit
      : { ...edit, setup: { ...edit.setup, taper: { ...current, enabled: false } } };
  }
  const taper = current === undefined ? newRotaryTaper(edit.setup) : { ...current, enabled: true };
  return { ...edit, setup: withWiderEnd({ ...edit.setup, taper }) };
}

export function editRotaryTaper(edit: RotaryEdit, patch: RotaryTaperPatch): RotaryEdit {
  const current = edit.setup.taper;
  if (current === undefined) return edit;
  return { ...edit, setup: withWiderEnd({ ...edit.setup, taper: { ...current, ...patch } }) };
}

/** The diameter Object diameter takes while the taper is on. */
export function taperWiderDiameterMm(taper: RotaryTaper): number {
  return Math.max(taper.topDiameterMm, taper.bottomDiameterMm);
}

function withWiderEnd(setup: RotarySetup): RotarySetup {
  const taper = setup.taper;
  if (taper === undefined || !taper.enabled) return setup;
  const widerMm = taperWiderDiameterMm(taper);
  return Number.isFinite(widerMm) && widerMm > 0 ? { ...setup, objectDiameterMm: widerMm } : setup;
}
