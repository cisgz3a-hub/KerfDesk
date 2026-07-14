import type { CurveSubpath } from '../scene';
import { refineChainForOutput } from '../trace/centerline/curve-refine';
import { parseHersheyJhf } from './hershey-font';
import { HERSHEY_SIMPLEX_JHF } from './hershey-simplex-data';
import {
  renderStrokeFontText,
  type StrokeFont,
  type StrokeTextRenderInput,
} from './stroke-font-text';
import { strokeGlyph, svgStrokeFont } from './svg-stroke-font';
import type { TextRenderResult } from './text-to-polylines';

const HERSHEY_CAP_HEIGHT_UNITS = 21;
const FIRST_PRINTABLE_ASCII = 32;
const HERSHEY_SIMPLEX_FONT = hersheySimplexFont();
const emsFontCache = new Map<string, StrokeFont>();
const EMS_FIT_TOLERANCE_RATIO: Readonly<Record<string, number>> = {
  'ems-allure': 0.006,
  'ems-delight': 0.005,
  'ems-tech': 0.003,
};

export type SingleLineTextRenderInput = StrokeTextRenderInput & {
  readonly fontKey: string;
};

/** Renders the selected bundled CNC font as open stroke geometry. */
export async function singleLineTextToPolylines(
  input: SingleLineTextRenderInput,
): Promise<TextRenderResult> {
  const font =
    input.fontKey === 'hershey-simplex' ? HERSHEY_SIMPLEX_FONT : await loadEmsFont(input.fontKey);
  return renderStrokeFontText(input, font);
}

function hersheySimplexFont(): StrokeFont {
  const glyphs = parseHersheyJhf(HERSHEY_SIMPLEX_JHF);
  return {
    capHeight: HERSHEY_CAP_HEIGHT_UNITS,
    yAxis: 'down',
    glyphs: new Map(
      glyphs.map((glyph, index) => [
        String.fromCharCode(FIRST_PRINTABLE_ASCII + index),
        strokeGlyph(
          glyph.right - glyph.left,
          glyph.strokes.map((stroke): CurveSubpath => {
            const refined = refineChainForOutput(stroke, false);
            return {
              start: {
                x: (refined[0]?.x ?? glyph.left) - glyph.left,
                y: refined[0]?.y ?? 0,
              },
              closed: false,
              segments: refined.slice(1).map((point) => ({
                kind: 'line' as const,
                to: { x: point.x - glyph.left, y: point.y },
              })),
            };
          }),
        ),
      ]),
    ),
  };
}

async function loadEmsFont(fontKey: string): Promise<StrokeFont> {
  const cached = emsFontCache.get(fontKey);
  if (cached !== undefined) return cached;
  const { EMS_STROKE_FONT_DATA } = await import('./ems-stroke-font-data');
  const data = EMS_STROKE_FONT_DATA.find((font) => font.key === fontKey);
  if (data === undefined) throw new Error(`Unsupported single-line font "${fontKey}".`);
  const toleranceRatio = EMS_FIT_TOLERANCE_RATIO[fontKey];
  const compiled = svgStrokeFont(
    data,
    toleranceRatio === undefined
      ? undefined
      : { fitToleranceUnits: data.capHeight * toleranceRatio },
  );
  emsFontCache.set(fontKey, compiled);
  return compiled;
}
