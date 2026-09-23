// Randomized property checks of painted second passes (ADR-341 §2-§3) over
// real emitter output: grayscale and dithered rasters, fills with cross-hatch,
// constant-power vectors, repeated passes, air assist and all five machine
// origins. Every property is judged by interpreters that share no code with the
// transformer (program-oracle, laser-burn-oracle).

import { describe, expect, it } from 'vitest';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutput } from '../../io/gcode/prepare-output';
import {
  burnGeometryKeyAt,
  oracleBurns,
  type OracleBurn,
} from '../controllers/grbl/laser-burn-oracle.test-helper';
import { buildResumeProgram } from '../controllers/grbl/resume-program';
import { profileCatalogEntryById, type Origin } from '../devices';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../scene';
import { createEllipse, createRectangle } from '../shapes/primitives';
import { buildLaserSecondPassProgram } from './index';
import { containsInterior, maskScaleAt, simulateProgram } from './program-oracle.test-helper';
import type {
  LaserSecondPassSegment,
  LaserSecondPassSelection,
  LaserSecondPassStroke,
} from './types';

const ORIGINS: ReadonlyArray<Origin> = [
  'front-left',
  'front-right',
  'rear-left',
  'rear-right',
  'center',
];
const LASER = {
  machineKind: 'laser',
  safeZMm: 0,
  spindleSpinupSec: 0,
  plungeMmPerMin: 300,
} as const;
const COLORS = { fill: '#000000', line: '#ff0000', image: '#808080' } as const;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function emitted(project: Project): string {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.preflight));
  return emitPreparedGcode(prepared).gcode;
}

function image(dither: 'grayscale' | 'floyd-steinberg', pixels: number): SceneObject {
  const luma = Array.from({ length: pixels * pixels }, (_, i) => (i * 53 + 17) % 256);
  return {
    kind: 'raster-image',
    id: `photo-${dither}`,
    color: COLORS.image,
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,archived-preview-is-not-the-machining-source',
    lumaBase64: Buffer.from(luma).toString('base64'),
    pixelWidth: pixels,
    pixelHeight: pixels,
    bounds: { minX: 40, minY: 30, maxX: 46, maxY: 36 },
    transform: IDENTITY_TRANSFORM,
    dither,
    linesPerMm: 2,
  };
}

function falconImage(origin: Origin): Project {
  const profile = profileCatalogEntryById('creality-falcon-a1-pro-grblhal')?.profile;
  if (profile === undefined) throw new Error('Falcon profile fixture missing');
  const base = createProject({ ...profile, origin });
  return {
    ...base,
    scene: {
      ...base.scene,
      objects: [image('grayscale', 8)],
      layers: [
        {
          ...createLayer({ id: 'image', color: COLORS.image, mode: 'image' }),
          ditherAlgorithm: 'grayscale',
          linesPerMm: 2,
          imageBidirectional: true,
          passes: 2,
          power: 80,
          speed: 1200,
          airAssist: true,
        },
      ],
    },
  };
}

function grblVectorFill(origin: Origin): Project {
  const base = createProject({ ...createProject().device, origin, airAssistCommand: 'M8' });
  return {
    ...base,
    scene: {
      ...base.scene,
      objects: [
        createRectangle({
          id: 'fill',
          color: COLORS.fill,
          transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
          spec: { widthMm: 8, heightMm: 5, cornerRadiusMm: 1 },
        }),
        createEllipse({
          id: 'line',
          color: COLORS.line,
          transform: { ...IDENTITY_TRANSFORM, x: 22, y: 21 },
          spec: { widthMm: 5, heightMm: 4 },
        }),
      ],
      layers: [
        {
          ...createLayer({ id: 'fill', color: COLORS.fill, mode: 'fill' }),
          hatchSpacingMm: 0.5,
          fillCrossHatch: true,
          power: 40,
          airAssist: true,
        },
        {
          ...createLayer({ id: 'line', color: COLORS.line, mode: 'line' }),
          powerMode: 'constant',
          speed: 600,
          power: 60,
          passes: 2,
          airAssist: false,
        },
      ],
    },
  };
}

function ditheredImage(origin: Origin): Project {
  const base = createProject({ ...createProject().device, origin });
  return {
    ...base,
    scene: {
      ...base.scene,
      objects: [image('floyd-steinberg', 8)],
      layers: [
        {
          ...createLayer({ id: 'image', color: COLORS.image, mode: 'image' }),
          ditherAlgorithm: 'floyd-steinberg',
          linesPerMm: 2,
          imageBidirectional: false,
          power: 70,
          speed: 1500,
        },
      ],
    },
  };
}

const SOURCES = [
  { name: 'Falcon grayscale image, 2 passes, air', project: falconImage },
  { name: 'GRBL cross-hatched fill with air and a 2-pass M3 outline', project: grblVectorFill },
  { name: 'GRBL dithered one-way image', project: ditheredImage },
] as const;

function randomSelection(
  random: () => number,
  burns: ReadonlyArray<LaserSecondPassSegment>,
  maxPowerS: number,
): LaserSecondPassSelection {
  const xs = burns.flatMap((move) => [move.from.x, move.to.x]);
  const ys = burns.flatMap((move) => [move.from.y, move.to.y]);
  const box = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
  const point = () => ({
    x: box.minX + (box.maxX - box.minX) * random(),
    y: box.minY + (box.maxY - box.minY) * random(),
  });
  const scales = [0.5, 0.8, 1, 1.25, 1.5, 2];
  const strokes: LaserSecondPassStroke[] = Array.from(
    { length: 1 + Math.floor(random() * 4) },
    (_, index) => ({
      id: `s${index}`,
      mode: index === 0 || random() < 0.65 ? 'paint' : 'erase',
      radiusMm: 0.3 + random() * 2.2,
      powerScale: scales[Math.floor(random() * scales.length)] ?? 1,
      points: Array.from({ length: 1 + Math.floor(random() * 4) }, point),
    }),
  );
  return { version: 1, maxPowerS, strokes };
}

function exposureAt(moves: ReadonlyArray<LaserSecondPassSegment>, point: { x: number; y: number }) {
  return moves
    .filter((move) => move.power > 0 && containsInterior(move, point))
    .map((move) => `${move.power}:${move.feed}:${move.mode}`)
    .sort();
}

type CaseResult = { readonly derived: string; readonly original: ReadonlyArray<OracleBurn> };

function checkCase(source: string, selection: LaserSecondPassSelection): CaseResult | null {
  const result = buildLaserSecondPassProgram(source, selection);
  if (result.kind === 'error') {
    expect(result.message).toBe('Paint an area that crosses an engraved part of this job.');
    return null;
  }
  const original = simulateProgram(source);
  const output = simulateProgram(result.gcode);
  // Exposure: every sampled original burn point is repeated at the latest
  // covering stroke's scale (capped), or not at all when unpainted or erased.
  for (const move of original.filter((item) => item.power > 0)) {
    for (let sample = 0; sample < 7; sample += 1) {
      const t = (sample + 0.371) / 7;
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
    }
  }
  // Containment: powered output lies on original burns inside painted coverage.
  for (const move of output.filter((item) => item.power > 0)) {
    const mid = { x: (move.from.x + move.to.x) / 2, y: (move.from.y + move.to.y) / 2 };
    expect(maskScaleAt(mid, selection.strokes)).toBeGreaterThan(0);
    expect(original.some((item) => item.power > 0 && containsInterior(item, mid))).toBe(true);
  }
  // Beam safety: positioning is dark and the program ends with the beam off.
  const lines = result.gcode.trimEnd().split('\n');
  expect(lines.filter((line) => /^G0/.test(line)).every((line) => /S0$/.test(line))).toBe(true);
  expect(lines.slice(-2).includes('M5')).toBe(true);
  return { derived: result.gcode, original: oracleBurns(source) };
}

function airOfCoveringOriginal(
  original: ReadonlyArray<OracleBurn>,
  burn: OracleBurn,
): ReadonlyArray<string> {
  const mid = { x: (burn.from.x + burn.to.x) / 2, y: (burn.from.y + burn.to.y) / 2 };
  const asSegment = (item: OracleBurn): LaserSecondPassSegment => ({
    from: item.from,
    to: item.to,
    power: item.power,
    feed: item.feed,
    mode: item.beam,
    rapid: false,
  });
  return [
    ...new Set(
      original.filter((item) => containsInterior(asSegment(item), mid)).map((item) => item.air),
    ),
  ];
}

describe('randomized painted passes over real emitter output and every machine origin', () => {
  it.each(SOURCES)(
    '$name: exposure, containment, beam safety and air assist hold for 60 random selections',
    ({ project }) => {
      let built = 0;
      for (const [originIndex, origin] of ORIGINS.entries()) {
        const source = emitted(project(origin));
        const burns = simulateProgram(source).filter((move) => move.power > 0);
        expect(burns.length).toBeGreaterThan(10);
        const random = mulberry32(9001 + originIndex * 131);
        for (let trial = 0; trial < 12; trial += 1) {
          const outcome = checkCase(source, randomSelection(random, burns, 1000));
          if (outcome === null) continue;
          built += 1;
          for (const burn of oracleBurns(outcome.derived)) {
            expect(airOfCoveringOriginal(outcome.original, burn)).toEqual([burn.air]);
          }
        }
      }
      expect(built).toBeGreaterThan(30);
    },
    120_000,
  );

  it.each(SOURCES)(
    '$name: an interrupted painted pass resumes with the same burn geometry from any line',
    ({ project }) => {
      const source = emitted(project('front-left'));
      const burns = simulateProgram(source).filter((move) => move.power > 0);
      const random = mulberry32(4242);
      let checked = 0;
      for (let trial = 0; trial < 20 && checked < 8; trial += 1) {
        const result = buildLaserSecondPassProgram(source, randomSelection(random, burns, 1000));
        if (result.kind === 'error') continue;
        const derived = result.gcode;
        const all = oracleBurns(derived);
        const lineCount = derived.split('\n').length;
        for (let sample = 0; sample < 6; sample += 1) {
          const fromLine = 1 + Math.floor(random() * (lineCount - 1));
          const resume = buildResumeProgram(derived, fromLine, LASER);
          if (resume.kind === 'error') continue;
          // The resume re-entry is written at 1 µm; painted chord points carry full
          // double precision, so compare at the controller's resolution.
          const resumed = oracleBurns(resume.lines.join('\n'), { x: 555, y: 444 });
          const expected = all.filter((burn) => burn.line >= fromLine);
          expect(resumed.map(burnGeometryKeyAt(3))).toEqual(expected.map(burnGeometryKeyAt(3)));
        }
        checked += 1;
      }
      expect(checked).toBeGreaterThan(3);
    },
    120_000,
  );
});
