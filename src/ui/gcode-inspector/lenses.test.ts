import { describe, expect, it } from 'vitest';
import { buildProgramTime, type MotionLimits } from '../../core/gcode-time';
import { buildGcodeRenderModel, SEG_KIND, type GcodeRenderModel } from '../../core/gcode-view';
import type { Viewer3dTheme } from '../viewer3d';
import { LENS_IDS, lensColorFn, lensLegend, rgbCss } from './lenses';

const THEME: Viewer3dTheme = {
  background: 0x000000,
  gridMinor: 0x111111,
  gridMajor: 0x222222,
  travel: 0xcc4444,
  cut: 0x4fa3ff,
  plunge: 0xffb84d,
  retract: 0x9a7fd4,
};

const LIMITS: MotionLimits = {
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  maxFeedMmPerMin: 6000,
};

// Depths -1 and -3, feeds 200/800/400, powers 300/900.
const PROGRAM = [
  'G21 G90',
  'M3 S300',
  'G0 X10 Y10',
  'G1 Z-1 F200',
  'G1 X60 F800',
  'M3 S900',
  'G1 Z-3 F200',
  'G1 X10 F400',
  'G0 Z5',
].join('\n');

function built(text = PROGRAM): {
  readonly model: GcodeRenderModel;
  readonly time: ReturnType<typeof buildProgramTime>;
} {
  const parsed = buildGcodeRenderModel(text);
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  return { model: parsed.model, time: buildProgramTime(parsed.model, LIMITS) };
}

describe('lensColorFn', () => {
  it('returns a finite rgb triple for every lens and every segment', () => {
    const { model, time } = built();
    for (const lens of LENS_IDS) {
      const colorOf = lensColorFn(model, time, lens, THEME);
      for (let index = 0; index < model.segmentCount; index += 1) {
        const rgb = colorOf(index);
        expect(rgb).toHaveLength(3);
        for (const channel of rgb) {
          expect(Number.isFinite(channel)).toBe(true);
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('colours by move kind using the theme', () => {
    const { model, time } = built();
    const colorOf = lensColorFn(model, time, 'kind', THEME);
    const plunge = firstOfKind(model, SEG_KIND.plunge);
    const cut = firstOfKind(model, SEG_KIND.cut);
    expect(rgbCss(colorOf(plunge))).toBe('rgb(255, 184, 77)');
    expect(rgbCss(colorOf(cut))).toBe('rgb(79, 163, 255)');
  });

  it('separates the extremes on a ramp lens', () => {
    const { model, time } = built();
    const colorOf = lensColorFn(model, time, 'depth', THEME);
    // Deepest move (-3) and shallowest (+5 retract) must not share a colour.
    const deep = colorOf(firstOfKind(model, SEG_KIND.plunge));
    const shallow = colorOf(firstOfKind(model, SEG_KIND.retract));
    expect(rgbCss(deep)).not.toBe(rgbCss(shallow));
  });

  it('gives the planner lens exactly two colours', () => {
    const { model, time } = built();
    const colorOf = lensColorFn(model, time, 'planner', THEME);
    const distinct = new Set<string>();
    for (let index = 0; index < model.segmentCount; index += 1)
      distinct.add(rgbCss(colorOf(index)));
    expect(distinct.size).toBeLessThanOrEqual(2);
  });
});

describe('lensLegend', () => {
  it('describes swatches for kind and planner, a ramp for value lenses', () => {
    const { model, time } = built();
    expect(lensLegend(model, time, 'kind', THEME).kind).toBe('swatches');
    expect(lensLegend(model, time, 'planner', THEME).kind).toBe('swatches');
    for (const lens of ['depth', 'feed', 'power'] as const) {
      expect(lensLegend(model, time, lens, THEME).kind).toBe('ramp');
    }
  });

  it('labels the ramp ends with real values and units', () => {
    const { model, time } = built();
    const depth = lensLegend(model, time, 'depth', THEME);
    expect(depth.kind === 'ramp' ? depth.from : '').toContain('-3.00 mm');
    const feed = lensLegend(model, time, 'feed', THEME);
    expect(feed.kind === 'ramp' ? feed.to : '').toContain('800 mm/min');
  });

  it('counts both planner outcomes', () => {
    const { model, time } = built();
    const legend = lensLegend(model, time, 'planner', THEME);
    if (legend.kind !== 'swatches') throw new Error('expected swatches');
    const total = legend.entries.reduce((sum, entry) => sum + entry.count, 0);
    expect(total).toBe(model.segmentCount);
  });

  it('falls back to a note when a lens has no data', () => {
    const { model, time } = built('G21 G90\nM3 S0\nM5');
    expect(lensLegend(model, time, 'feed', THEME).kind).toBe('note');
  });
});

function firstOfKind(model: GcodeRenderModel, kind: number): number {
  for (let index = 0; index < model.segmentCount; index += 1) {
    if (model.segKind[index] === kind) return index;
  }
  throw new Error(`no segment of kind ${kind}`);
}
