import {
  renderStrokeFontText,
  type StrokeFont,
  type StrokeTextRenderInput,
} from './stroke-font-text';
import { svgStrokeFont } from './svg-stroke-font';
import type { TextRenderResult } from './text-to-polylines';

const fontCache = new Map<string, StrokeFont>();

export type CncStrokeTextRenderInput = StrokeTextRenderInput & {
  readonly fontKey: string;
};

/** Renders a bundled OFL CNC face as its native open machining strokes. */
export async function cncStrokeTextToPolylines(
  input: CncStrokeTextRenderInput,
): Promise<TextRenderResult> {
  return renderStrokeFontText(input, await loadCncStrokeFont(input.fontKey));
}

async function loadCncStrokeFont(fontKey: string): Promise<StrokeFont> {
  const cached = fontCache.get(fontKey);
  if (cached !== undefined) return cached;
  const { CNC_STROKE_FONT_DATA } = await import('./cnc-stroke-font-data');
  const source = CNC_STROKE_FONT_DATA.find((font) => font.key === fontKey);
  if (source === undefined) throw new Error(`Unsupported CNC single-line font "${fontKey}".`);
  const compiled = svgStrokeFont(source);
  fontCache.set(fontKey, compiled);
  return compiled;
}
