// Cut Settings draft for the ADR-385 Line options: Overcut and tab spacing.
//
// Every option is absent on operations saved before it existed, and absent
// means today's behaviour. A field is only written when the operator changes
// what it does, so opening Cut Settings and pressing Apply never adds
// "overcutMm: 0" or "tabPlacement: per-shape" to a layer that had neither.

import {
  DEFAULT_TAB_MAX_PER_SHAPE,
  DEFAULT_TAB_MIN_PER_SHAPE,
  DEFAULT_TAB_SPACING_MM,
} from '../../core/geometry/tab-spacing';
import { MAX_LINE_OVERCUT_MM } from '../../core/job/line-overcut';
import type { Layer, LayerMode } from '../../core/scene';
import type { LayerLineCutOptions, TabPlacement } from '../../core/scene/layer';

export const MIN_TAB_SPACING_MM = 1;
export const MAX_TAB_SPACING_MM = 10_000;
export const MAX_TAB_COUNT_PER_SHAPE = 100;

export function readLineCutOptionsPatch(
  data: FormData,
  layer: Layer,
  mode: LayerMode,
): LayerLineCutOptions {
  if (mode !== 'line') {
    return {
      overcutMm: layer.overcutMm,
      tabPlacement: layer.tabPlacement,
      tabSpacingMm: layer.tabSpacingMm,
      tabMinPerShape: layer.tabMinPerShape,
      tabMaxPerShape: layer.tabMaxPerShape,
    };
  }
  return {
    overcutMm: edited(layer.overcutMm, 0, readNumber(data, 'overcutMm', 0, MAX_LINE_OVERCUT_MM)),
    tabPlacement: edited(layer.tabPlacement, 'per-shape', readPlacement(data)),
    tabSpacingMm: edited(
      layer.tabSpacingMm,
      DEFAULT_TAB_SPACING_MM,
      readNumber(data, 'tabSpacingMm', MIN_TAB_SPACING_MM, MAX_TAB_SPACING_MM),
    ),
    tabMinPerShape: edited(
      layer.tabMinPerShape,
      DEFAULT_TAB_MIN_PER_SHAPE,
      readCount(data, 'tabMinPerShape'),
    ),
    tabMaxPerShape: edited(
      layer.tabMaxPerShape,
      DEFAULT_TAB_MAX_PER_SHAPE,
      readCount(data, 'tabMaxPerShape'),
    ),
  };
}

// Keep what is stored (usually nothing) unless the value in effect changed.
function edited<T>(stored: T | undefined, fallback: T, next: T | null): T | undefined {
  if (next === null) return stored;
  return next === (stored ?? fallback) ? stored : next;
}

function readPlacement(data: FormData): TabPlacement | null {
  const value = data.get('tabPlacement');
  return value === 'per-shape' || value === 'spacing' ? value : null;
}

function readCount(data: FormData, name: string): number | null {
  const value = readNumber(data, name, 1, MAX_TAB_COUNT_PER_SHAPE);
  return value === null ? null : Math.floor(value);
}

function readNumber(data: FormData, name: string, min: number, max: number): number | null {
  const parsed = Number.parseFloat(String(data.get(name) ?? ''));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.min(max, parsed));
}
