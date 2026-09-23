// Oracle equivalence for laser start-from-line recovery (ADR-103 G7, ADR-141,
// ADR-341). For real KerfDesk emitter output and every restart line, the
// resumed program must burn exactly what the original program burns from that
// line on: the same segments, power, feed, beam mode, work frame and air
// assist. Burns come from an independent interpreter (laser-burn-oracle).
//
// The resumed program starts on a controller that has just been reconnected:
// an arbitrary head position, beam off and coolant/air off (GRBL clears both on
// reset; KerfDesk sends M9 after an abort).

import { describe, expect, it } from 'vitest';
import { emitPreparedGcode } from '../../../io/gcode/emit-gcode';
import { prepareOutput } from '../../../io/gcode/prepare-output';
import { profileCatalogEntryById } from '../../devices';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../scene';
import { createEllipse, createRectangle } from '../../shapes/primitives';
import {
  burnGeometryKey,
  burnLengthMm,
  oracleBurns,
  type OracleBurn,
} from './laser-burn-oracle.test-helper';
import { buildResumeProgram } from './resume-program';

const LASER = {
  machineKind: 'laser',
  safeZMm: 0,
  spindleSpinupSec: 0,
  plungeMmPerMin: 300,
} as const;
const RECONNECTED_HEAD = { x: 987.654, y: 876.543 };

/** Every restart line on small programs; for large ones every line within two of
 * a modal change plus an even stride, so group boundaries are never skipped. */
function restartLines(gcode: string): number[] {
  const lines = gcode.split('\n');
  if (lines.length <= 600) return lines.map((_, index) => index + 1);
  const chosen = new Set<number>();
  lines.forEach((raw, index) => {
    if (/M[3-9]\b/i.test(raw) || /G0\b|G00\b/i.test(raw)) {
      for (let offset = -2; offset <= 2; offset += 1) chosen.add(index + 1 + offset);
    }
  });
  const stride = Math.max(1, Math.floor(lines.length / 250));
  for (let line = 1; line <= lines.length; line += stride) chosen.add(line);
  return [...chosen].filter((line) => line >= 1 && line <= lines.length).sort((a, b) => a - b);
}

type Divergence = {
  readonly fromLine: number;
  readonly lostBurnMm: number;
  readonly detail: string;
};
type Divergences = {
  readonly checked: number;
  /** Burned geometry, power, feed, beam mode or work frame differ. */
  readonly motion: Divergence[];
  /** Geometry agrees but air assist differs. */
  readonly air: Divergence[];
};

function motionDivergence(
  fromLine: number,
  expected: ReadonlyArray<OracleBurn>,
  actual: ReadonlyArray<OracleBurn>,
): Divergence | null {
  const actualKeys = actual.map(burnGeometryKey);
  if (JSON.stringify(expected.map(burnGeometryKey)) === JSON.stringify(actualKeys)) return null;
  const missing = expected.filter((burn) => !actualKeys.includes(burnGeometryKey(burn)));
  return {
    fromLine,
    lostBurnMm: burnLengthMm(missing),
    detail: `${actual.length} burns resumed vs ${expected.length} original; first missing: ${JSON.stringify(missing[0] ?? null)}`,
  };
}

function resumeDivergences(gcode: string): Divergences {
  const original = oracleBurns(gcode);
  const result = { checked: 0, motion: [] as Divergence[], air: [] as Divergence[] };
  for (const fromLine of restartLines(gcode)) {
    const resume = buildResumeProgram(gcode, fromLine, LASER);
    if (resume.kind === 'error') {
      if (resume.reason !== 'Nothing left to run from that line.')
        result.motion.push({ fromLine, lostBurnMm: NaN, detail: resume.reason });
      continue;
    }
    result.checked += 1;
    const expected = original.filter((burn) => burn.line >= fromLine);
    const actual = oracleBurns(resume.lines.join('\n'), RECONNECTED_HEAD);
    const motion = motionDivergence(fromLine, expected, actual);
    if (motion !== null) {
      result.motion.push(motion);
      continue;
    }
    const airIndex = actual.findIndex((burn, index) => burn.air !== expected[index]?.air);
    if (airIndex >= 0) {
      result.air.push({
        fromLine,
        lostBurnMm: 0,
        detail: `resumed burn from source line ${expected[airIndex]?.line} runs with air ${actual[airIndex]?.air}, original ${expected[airIndex]?.air}`,
      });
    }
  }
  return result;
}

function emitted(project: Project): string {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.preflight));
  return emitPreparedGcode(prepared).gcode;
}

function falconProfile(): Project['device'] {
  const profile = profileCatalogEntryById('creality-falcon-a1-pro-grblhal')?.profile;
  if (profile === undefined) throw new Error('Falcon profile fixture missing');
  return profile;
}

const COLORS = { fill: '#000000', line: '#ff0000', image: '#808080' } as const;

function artwork(): SceneObject[] {
  return [
    createRectangle({
      id: 'fill',
      color: COLORS.fill,
      transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
      spec: { widthMm: 8, heightMm: 5, cornerRadiusMm: 0 },
    }),
    createEllipse({
      id: 'line',
      color: COLORS.line,
      transform: { ...IDENTITY_TRANSFORM, x: 35, y: 22 },
      spec: { widthMm: 5, heightMm: 4 },
    }),
    {
      kind: 'raster-image',
      id: 'photo',
      color: COLORS.image,
      source: 'photo.png',
      dataUrl: 'data:image/png;base64,archived-preview-is-not-the-machining-source',
      lumaBase64: Buffer.from([
        0, 64, 128, 255, 255, 128, 64, 0, 32, 96, 160, 223, 223, 160, 96, 32,
      ]).toString('base64'),
      pixelWidth: 4,
      pixelHeight: 4,
      bounds: { minX: 50, minY: 30, maxX: 54, maxY: 34 },
      transform: IDENTITY_TRANSFORM,
      dither: 'grayscale',
      linesPerMm: 2,
    },
  ];
}

function mixedProject(device: Project['device'], air: boolean): Project {
  const base = createProject(device);
  return {
    ...base,
    scene: {
      ...base.scene,
      objects: artwork(),
      layers: [
        {
          ...createLayer({ id: 'fill', color: COLORS.fill, mode: 'fill' }),
          hatchSpacingMm: 0.5,
          power: 40,
          passes: 2,
          airAssist: air,
        },
        {
          ...createLayer({ id: 'line', color: COLORS.line, mode: 'line' }),
          powerMode: 'constant',
          speed: 600,
          power: 60,
          airAssist: false,
        },
        {
          ...createLayer({ id: 'image', color: COLORS.image, mode: 'image' }),
          ditherAlgorithm: 'grayscale',
          linesPerMm: 2,
          imageBidirectional: true,
          power: 80,
          speed: 1200,
          airAssist: air,
        },
      ],
    },
  };
}

const SCENARIOS: ReadonlyArray<{ readonly name: string; readonly project: () => Project }> = [
  {
    name: 'GRBL profile with air on the fill and image',
    project: () => mixedProject({ ...createProject().device, airAssistCommand: 'M8' }, true),
  },
  {
    name: 'GRBL profile without air assist',
    project: () => mixedProject(createProject().device, false),
  },
  {
    name: 'Falcon grblHAL profile (compact motion words, air held across groups)',
    project: () => mixedProject(falconProfile(), true),
  },
  {
    name: 'Falcon grblHAL profile with controlled-dark row changes at the engraving feed',
    project: () =>
      mixedProject({ ...falconProfile(), controlledLaserOffTravelFeedMmPerMin: 1200 }, true),
  },
];

describe('laser resume against an independent interpreter of real emitter output', () => {
  it.each(SCENARIOS)(
    '$name: every restart line burns the same geometry, power, feed and beam mode',
    ({ project }) => {
      const gcode = emitted(project());
      expect(oracleBurns(gcode).length).toBeGreaterThan(20);
      const { checked, motion } = resumeDivergences(gcode);
      expect(checked).toBeGreaterThan(20);
      expect(motion.slice(0, 3)).toEqual([]);
    },
    60_000,
  );

  it.each(SCENARIOS.filter((scenario) => !scenario.name.includes('without air')))(
    '$name: every resumed burn keeps the air assist the original burn had',
    ({ project }) => {
      const { checked, air } = resumeDivergences(emitted(project()));
      expect(checked).toBeGreaterThan(20);
      expect(air.slice(0, 3)).toEqual([]);
    },
    60_000,
  );
});

describe('minimal reproductions', () => {
  it('a raster continuation line resumed after the G0 re-entry still burns', () => {
    const gcode = [
      'G21',
      'G90',
      'M4 S0',
      'G0X0Y0S0',
      'G1X1F1200S100',
      'X2S200', // modal G1 continuation: the restart line
      'X3S300',
      'M5',
    ].join('\n');
    const resume = buildResumeProgram(gcode, 6, LASER);
    if (resume.kind === 'error') throw new Error(resume.reason);
    const resumed = oracleBurns(resume.lines.join('\n'), { x: 50, y: 50 });
    expect(resumed.map((burn) => [burn.from.x, burn.to.x, burn.power])).toEqual([
      [1, 2, 200],
      [2, 3, 300],
    ]);
  });

  it('air assist switched on before the restart line is on for the resumed burn', () => {
    const gcode = [
      'G21',
      'G90',
      'M4 S0',
      'M8',
      'G0X0Y0S0',
      'G1X1F1200S100',
      'G1X2S200', // restart line
      'M9',
      'M5',
    ].join('\n');
    const resume = buildResumeProgram(gcode, 7, LASER);
    if (resume.kind === 'error') throw new Error(resume.reason);
    expect(oracleBurns(resume.lines.join('\n'), { x: 50, y: 50 })).toMatchObject([
      { from: { x: 1, y: 0 }, to: { x: 2, y: 0 }, power: 200, air: 'M8' },
    ]);
  });
});
