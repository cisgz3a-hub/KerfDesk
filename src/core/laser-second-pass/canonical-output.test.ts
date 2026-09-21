import { describe, expect, it } from 'vitest';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { profileCatalogEntryById } from '../devices';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../scene';
import { createEllipse, createRectangle } from '../shapes/primitives';
import { buildLaserSecondPassProgram, parseLaserSecondPassSource } from './index';
import { containsInterior, maskScaleAt, simulateProgram } from './program-oracle.test-helper';
import type {
  LaserSecondPassPoint,
  LaserSecondPassSegment,
  LaserSecondPassSelection,
} from './types';

function canonicalSource(project: Project): string {
  const prepared = prepareOutput(project);
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.preflight));
  const output = emitPreparedGcode(prepared);
  expect(output.gcode.length).toBeGreaterThan(50);
  return output.gcode;
}

function brush(
  points: ReadonlyArray<LaserSecondPassPoint>,
  radiusMm = 1.3,
): LaserSecondPassSelection {
  return {
    version: 1,
    maxPowerS: 1000,
    strokes: [
      { id: 'paint', mode: 'paint', radiusMm, powerScale: 1.5, points },
      { id: 'erase', mode: 'erase', radiusMm: 0.25, powerScale: 1, points: [points[0]!] },
    ],
  };
}

function exposureAt(motions: ReadonlyArray<LaserSecondPassSegment>, point: LaserSecondPassPoint) {
  return motions
    .filter((move) => move.power > 0 && containsInterior(move, point))
    .map((move) => `${move.power}:${move.feed}:${move.mode}`)
    .sort();
}

function routeBrush(motions: ReadonlyArray<LaserSecondPassSegment>): LaserSecondPassSelection {
  const points = motions.filter((move) => move.power > 0).flatMap((move) => [move.from, move.to]);
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return brush(
    [
      { x: minX + (maxX - minX) * 0.3, y: minY },
      { x: minX + (maxX - minX) * 0.7, y: maxY },
    ],
    1,
  );
}

function checkIndependentExposure(source: string, selection: LaserSecondPassSelection): string {
  const result = buildLaserSecondPassProgram(source, selection);
  expect(result.kind, result.kind === 'error' ? result.message : undefined).toBe('ready');
  if (result.kind !== 'ready') throw new Error(result.message);
  const original = simulateProgram(source);
  const output = simulateProgram(result.gcode);
  let comparisons = 0;
  for (const move of original.filter((item) => item.power > 0)) {
    for (let sample = 0; sample < 13; sample += 1) {
      const t = (sample + 0.417) / 13;
      const point = {
        x: move.from.x + (move.to.x - move.from.x) * t,
        y: move.from.y + (move.to.y - move.from.y) * t,
      };
      const scale = maskScaleAt(point, selection.strokes);
      const expected = original
        .filter((item) => item.power > 0 && containsInterior(item, point))
        .map((item) => ({ ...item, power: Math.min(selection.maxPowerS, item.power * scale) }))
        .filter((item) => item.power > 0)
        .map((item) => `${item.power}:${item.feed}:${item.mode}`)
        .sort();
      expect(exposureAt(output, point)).toEqual(expected);
      comparisons += 1;
    }
  }
  for (const move of output.filter((item) => item.power > 0)) {
    const point = { x: (move.from.x + move.to.x) / 2, y: (move.from.y + move.to.y) / 2 };
    expect(maskScaleAt(point, selection.strokes)).toBeGreaterThan(0);
    expect(
      original.some((candidate) => candidate.power > 0 && containsInterior(candidate, point)),
    ).toBe(true);
  }
  expect(comparisons).toBeGreaterThan(30);
  expect(output.filter((move) => move.power > 0).length).toBeGreaterThan(0);
  return result.gcode;
}

function imageProject(controlledDark: boolean): Project {
  const base = createProject();
  const profile = profileCatalogEntryById('creality-falcon-a1-pro-grblhal')?.profile;
  if (profile === undefined) throw new Error('Falcon profile fixture missing');
  const image: SceneObject = {
    kind: 'raster-image',
    id: 'photo',
    color: '#808080',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,archived-preview-is-not-the-machining-source',
    lumaBase64: Buffer.from([
      0, 64, 128, 255, 255, 128, 64, 0, 32, 96, 160, 223, 223, 160, 96, 32,
    ]).toString('base64'),
    pixelWidth: 4,
    pixelHeight: 4,
    bounds: { minX: 40, minY: 30, maxX: 44, maxY: 34 },
    transform: IDENTITY_TRANSFORM,
    dither: 'grayscale',
    linesPerMm: 2,
  };
  return {
    ...base,
    device: {
      ...profile,
      ...(controlledDark ? { controlledLaserOffTravelFeedMmPerMin: 800 } : {}),
      scanningOffsets: [{ speedMmPerMin: 1200, offsetMm: 0.175 }],
    },
    scene: {
      ...base.scene,
      objects: [image],
      layers: [
        {
          ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
          ditherAlgorithm: 'grayscale',
          linesPerMm: 2,
          imageBidirectional: true,
          dotWidthCorrectionMm: 0.06,
          passes: 2,
          power: 80,
          speed: 1200,
          airAssist: true,
        },
      ],
    },
  };
}

describe('second pass from the real prepared-output composition', () => {
  it.each([false, true])(
    'preserves Falcon image tones, bidirectionality, two passes, and corrected pixel edges (controlled dark %s)',
    (controlledDark) => {
      const source = canonicalSource(imageProject(controlledDark));
      const parser = parseLaserSecondPassSource(source);
      expect(parser.kind, parser.kind === 'error' ? parser.message : undefined).toBe('ready');
      const originalBurn = simulateProgram(source).filter((move) => move.power > 0);
      expect(new Set(originalBurn.map((move) => move.power)).size).toBeGreaterThan(3);
      expect(originalBurn.some((move) => move.to.x < move.from.x)).toBe(true);
      expect(originalBurn.some((move) => move.to.x > move.from.x)).toBe(true);
      const derived = checkIndependentExposure(source, routeBrush(originalBurn));
      expect(derived.split('\n').filter((line) => /^M[789]$/.test(line))).toEqual(['M8', 'M9']);
      if (controlledDark) expect(derived).not.toMatch(/^G0/m);
    },
  );

  it('supports native filled rectangles and curved vector artwork from emitted linear motion', () => {
    const base = createProject();
    const rectangle = createRectangle({
      id: 'fill',
      color: '#000000',
      transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
      spec: { widthMm: 10, heightMm: 6, cornerRadiusMm: 0 },
    });
    const ellipse = createEllipse({
      id: 'line',
      color: '#ff0000',
      transform: { ...IDENTITY_TRANSFORM, x: 23, y: 21 },
      spec: { widthMm: 5, heightMm: 4 },
    });
    const source = canonicalSource({
      ...base,
      scene: {
        ...base.scene,
        objects: [rectangle, ellipse],
        layers: [
          {
            ...createLayer({ id: 'fill', color: '#000000', mode: 'fill' }),
            hatchSpacingMm: 0.5,
            power: 40,
          },
          {
            ...createLayer({ id: 'line', color: '#ff0000', mode: 'line' }),
            powerMode: 'constant',
            speed: 600,
            power: 60,
          },
        ],
      },
    });
    const burn = simulateProgram(source).filter((move) => move.power > 0);
    expect(burn.some((move) => move.mode === 3)).toBe(true);
    expect(burn.some((move) => move.mode === 4)).toBe(true);
    expect(burn.some((move) => move.from.x !== move.to.x && move.from.y !== move.to.y)).toBe(true);
    checkIndependentExposure(source, routeBrush(burn));
  });

  it('handles a dense raster without collecting or replaying unselected rows', () => {
    const rows: string[] = ['G21', 'G90', 'M4S0'];
    for (let row = 0; row < 15000; row += 1) {
      rows.push(`G0X-1Y${row}S0`, 'G1X0F1800S0', 'X4S120', 'X7S0', 'X10S320', 'X11S0');
    }
    rows.push('M5');
    const selection: LaserSecondPassSelection = {
      version: 1,
      maxPowerS: 1000,
      strokes: Array.from({ length: 300 }, (_, i) => ({
        id: String(i),
        mode: 'paint',
        powerScale: 1,
        radiusMm: 0.2,
        points: [{ x: i === 0 ? 2 : 1000 + i * 10, y: 7450 }],
      })),
    };
    const result = buildLaserSecondPassProgram(rows.join('\n'), selection);
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error(result.message);
    expect(result.burnLengthMm).toBeCloseTo(0.4, 12);
    expect(result.gcode.length).toBeLessThan(400);
    expect(result.motionBounds).toEqual({ minX: -1, minY: 7450, maxX: 11, maxY: 7450 });
  }, 15000);
});
