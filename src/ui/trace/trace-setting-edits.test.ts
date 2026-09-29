// "Settings edited" follows the kept adjustments that change what the selected
// style traces, and the others are named as kept but not used (ADR-560).

import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS, type TraceOptions } from '../../core/trace';
import { edgeSensitivityFromOptions } from './trace-options';
import { traceSettingEdits } from './trace-setting-edits';

function preset(name: string): TraceOptions {
  const options = TRACE_PRESETS[name];
  if (options === undefined) throw new Error(`Missing preset ${name}`);
  return options;
}

const LINE_ART = preset('Line Art');
const SMOOTH = preset('Smooth');
const SHARP = preset('Sharp');
const CENTERLINE = preset('Centerline');
const LINE_FILL = preset('Line + fill');
const EDGE = preset('Edge Detection');
const PHOTO = preset('Photo shading');
const COLOUR = preset('Colour layers');

describe('which kept adjustments the selected style uses', () => {
  it('does not count the preset detection or an unchanged value as an edit', () => {
    expect(traceSettingEdits(LINE_ART, { detectionMode: 'preset' }, false)).toEqual({
      edited: false,
      unused: [],
    });
    // Line Art's own Ignore Less Than is 2; Smooth sets none.
    expect(traceSettingEdits(LINE_ART, { ignoreLessThanPixels: 2 }, false).edited).toBe(false);
    expect(traceSettingEdits(SMOOTH, { ignoreLessThanPixels: 2 }, false).edited).toBe(true);
  });

  it('keeps a manual band for later without counting it while automatic detection runs', () => {
    const band = { cutoffLuma: 0, thresholdLuma: 150 };
    expect(traceSettingEdits(SMOOTH, { ...band, detectionMode: 'manual' }, false)).toEqual({
      edited: true,
      unused: [],
    });
    expect(traceSettingEdits(SMOOTH, { ...band, detectionMode: 'preset' }, false)).toEqual({
      edited: false,
      unused: ['Cutoff', 'Threshold'],
    });
  });

  it('names kept adjustments the style has no control for', () => {
    const sensitivity = edgeSensitivityFromOptions(EDGE) === 0 ? 100 : 0;
    expect(
      traceSettingEdits(EDGE, { edgeSensitivity: sensitivity, ignoreLessThanPixels: 30 }, false),
    ).toEqual({ edited: true, unused: ['Ignore Less Than'] });
    expect(traceSettingEdits(LINE_ART, { edgeSensitivity: sensitivity }, false)).toEqual({
      edited: false,
      unused: ['Sensitivity'],
    });
    expect(traceSettingEdits(LINE_ART, { centerlineJoinGapPx: 7 }, false)).toEqual({
      edited: false,
      unused: ['Join gaps'],
    });
    expect(
      traceSettingEdits(
        CENTERLINE,
        { centerlineJoinGapPx: 7, ignoreLessThanPixels: 9, turnPolicy: 'connect-ink' },
        false,
      ),
    ).toEqual({ edited: true, unused: ['Ignore Less Than', 'Diagonal contacts'] });
    expect(
      traceSettingEdits(PHOTO, { photoGamma: 1.4, detectionMode: 'faint-lines' }, false),
    ).toEqual({ edited: true, unused: ['Detection'] });
    expect(traceSettingEdits(LINE_ART, { photoInvert: true }, false)).toEqual({
      edited: false,
      unused: ['Invert'],
    });
    expect(
      traceSettingEdits(COLOUR, { colourLayerOutput: 'stacked', smoothness: 0.5 }, false),
    ).toEqual({ edited: true, unused: ['Smoothness'] });
  });

  it('counts the alpha mask only on an image with transparency, where Invert stands down', () => {
    expect(traceSettingEdits(LINE_ART, { traceTransparency: true }, false)).toEqual({
      edited: false,
      unused: [],
    });
    const alphaBand = {
      traceTransparency: true,
      detectionMode: 'manual',
      cutoffLuma: 0,
      thresholdLuma: 90,
      invert: true,
    } as const;
    expect(traceSettingEdits(LINE_ART, alphaBand, true)).toEqual({
      edited: true,
      unused: ['Invert'],
    });
  });

  it('counts a Line + fill stroke width only where the style has one', () => {
    expect(traceSettingEdits(LINE_FILL, { hybridMaxStrokeWidthMm: 0.4 }, false)).toEqual({
      edited: true,
      unused: [],
    });
    expect(traceSettingEdits(SHARP, { hybridMaxStrokeWidthMm: 0.4 }, false)).toEqual({
      edited: false,
      unused: ['Max stroke width'],
    });
  });
});
