// Dialog overrides for the Colour layers preset (ADR-402), merged onto the
// preset's options. Kept apart from trace-options.ts so the line presets'
// merge stays untouched.

import type { TraceOptions } from '../../core/trace';
import {
  normalizedColourCount,
  type ColourLayerOptions,
  type ColourLayerOutput,
} from '../../core/trace/colour-layer-options';

export type ColourLayerSettingOverrides = {
  /** 'auto' or 2..8 colours including the background. */
  readonly colourCount?: number | 'auto';
  readonly colourLayerOutput?: ColourLayerOutput;
  readonly keepBackground?: boolean;
  readonly despeckleMinPixels?: number;
};

export function mergeColourLayerSettings(
  preset: TraceOptions,
  settings: ColourLayerSettingOverrides,
): TraceOptions {
  const base: ColourLayerOptions = preset.colourLayers ?? {};
  const requested =
    settings.colourCount === undefined
      ? base.colours
      : settings.colourCount === 'auto'
        ? undefined
        : normalizedColourCount(settings.colourCount);
  const colourLayers: ColourLayerOptions = {
    output: settings.colourLayerOutput ?? base.output ?? 'cut-out',
    ...(requested === undefined ? {} : { colours: requested }),
    ...((settings.keepBackground ?? base.keepBackground) === true ? { keepBackground: true } : {}),
  };
  return {
    ...preset,
    colourLayers,
    ...(settings.despeckleMinPixels === undefined
      ? {}
      : { despeckleMinPixels: Math.max(0, Math.round(settings.despeckleMinPixels)) }),
  };
}
