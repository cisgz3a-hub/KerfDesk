// Production-composition G-code snapshot corpus (H15, AUDIT-2026-06-10).
//
// The Phase-A pipeline snapshots (io/svg/pipeline.snapshot.test.ts) call
// compileJob → grblStrategy.emit directly, which BYPASSES the shipped
// composition: prepareOutput's pre-emit guard, applyJobOrigin, and
// optimizePaths. Everything shipped after Phase A — fill hatch + overscan,
// M4 raster sweeps, mixed-mode M3/M5/M4 ordering, user-origin placement,
// curve flattening — had no byte-pinned output at all, so a silent
// algorithm change produced zero snapshot churn and required no
// "Snapshot change acknowledged:" line.
//
// This corpus routes through emitGcode — the exact Save/Start composition
// (no metadata header, so output is deterministic). Any change to these
// snapshots is a change to what the machine runs.

import { describe, expect, it } from 'vitest';
import {
  collectG1SValues,
  expectedS,
  findLaserOnTravelIssues,
  findOutOfBoundsCoords,
} from '../../core/invariants';
import { USER_ORIGIN_JOB_PLACEMENT } from '../../core/job';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { parseSvg } from '../svg';
import { emitGcode } from './emit-gcode';

function projectWith(scene: Scene): Project {
  return { ...createProject(), scene };
}

function lineObject(args: {
  id: string;
  color: string;
  points: ReadonlyArray<{ x: number; y: number }>;
  closed?: boolean;
}): SceneObject {
  return {
    kind: 'imported-svg',
    id: args.id,
    source: `${args.id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      { color: args.color, polylines: [{ points: args.points, closed: args.closed ?? false }] },
    ],
  };
}

// Donut: a 40×40 outer square with a centered 20×20 hole. The even-odd
// scanline fill must skip the hole; the default 5 mm overscan extends each
// scanline's lead-in/out.
function donutObject(color: string): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'donut',
    source: 'donut.svg',
    bounds: { minX: 50, minY: 50, maxX: 90, maxY: 90 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            points: [
              { x: 50, y: 50 },
              { x: 90, y: 50 },
              { x: 90, y: 90 },
              { x: 50, y: 90 },
              { x: 50, y: 50 },
            ],
            closed: true,
          },
          {
            points: [
              { x: 60, y: 60 },
              { x: 80, y: 60 },
              { x: 80, y: 80 },
              { x: 60, y: 80 },
              { x: 60, y: 60 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
}

// 2×2 source pixels (black, white / white, black) on a 10×5 mm footprint.
// Threshold dither + 1 line/mm keeps the sweep small enough to read.
function rasterObject(color: string): SceneObject {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: 'AP//AA==',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 100, minY: 100, maxX: 110, maxY: 105 },
    transform: IDENTITY_TRANSFORM,
    color,
    dither: 'threshold',
    linesPerMm: 10,
  };
}

function fillLayer(color: string): Layer {
  return { ...createLayer({ id: `fill-${color}`, color, mode: 'fill' }), hatchSpacingMm: 2 };
}

function imageLayer(color: string): Layer {
  return {
    ...createLayer({ id: `image-${color}`, color, mode: 'image' }),
    ditherAlgorithm: 'threshold',
    linesPerMm: 1,
  };
}

function fillDonutProject(): Project {
  return projectWith({
    ...EMPTY_SCENE,
    objects: [donutObject('#0000ff')],
    layers: [fillLayer('#0000ff')],
  });
}

function rasterProject(): Project {
  return projectWith({
    ...EMPTY_SCENE,
    objects: [rasterObject('#808080')],
    layers: [imageLayer('#808080')],
  });
}

function mixedProject(): Project {
  return projectWith({
    ...EMPTY_SCENE,
    objects: [
      lineObject({
        id: 'cut',
        color: '#ff0000',
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
        ],
      }),
      donutObject('#0000ff'),
      rasterObject('#808080'),
    ],
    layers: [
      createLayer({ id: 'line-red', color: '#ff0000' }),
      fillLayer('#0000ff'),
      imageLayer('#808080'),
    ],
  });
}

function curveProject(): Project {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="M 10 50 C 10 20 50 20 50 50 A 20 20 0 0 1 90 50" stroke="#ff0000" fill="none"/>
</svg>`;
  const parsed = parseSvg({ svgText: svg, id: 'curves', source: 'curves.svg' });
  if (parsed.object === null) throw new Error('curve fixture produced no geometry');
  return projectWith({
    ...EMPTY_SCENE,
    objects: [parsed.object],
    layers: [createLayer({ id: 'line-red', color: '#ff0000' })],
  });
}

const CORPUS: ReadonlyArray<{ readonly id: string; readonly project: () => Project }> = [
  { id: 'fill-donut-with-overscan', project: fillDonutProject },
  { id: 'raster-2x2-threshold', project: rasterProject },
  { id: 'mixed-line-fill-image', project: mixedProject },
  { id: 'curve-bearing-svg', project: curveProject },
];

describe('emitGcode production composition — fixture snapshots', () => {
  for (const { id, project } of CORPUS) {
    it(`${id} produces stable G-code through the shipped pipeline`, () => {
      const { gcode, preflight } = emitGcode(project());
      expect(preflight.ok).toBe(true);
      expect(gcode).toMatchSnapshot();
    });
  }

  it('mixed scene with user-origin placement produces stable translated G-code', () => {
    const { gcode } = emitGcode(mixedProject(), { jobOrigin: USER_ORIGIN_JOB_PLACEMENT });
    expect(gcode).toMatchSnapshot();
  });
});

describe('emitGcode production composition — invariants', () => {
  for (const { id, project } of CORPUS) {
    it(`${id} — no laser-on travel`, () => {
      expect(findLaserOnTravelIssues(emitGcode(project()).gcode)).toEqual([]);
    });

    it(`${id} — all coords in bed`, () => {
      const p = project();
      expect(
        findOutOfBoundsCoords(emitGcode(p).gcode, {
          width: p.device.bedWidth,
          height: p.device.bedHeight,
        }),
      ).toEqual([]);
    });

    it(`${id} — determinism (two runs byte-identical)`, () => {
      expect(emitGcode(project()).gcode).toBe(emitGcode(project()).gcode);
    });
  }

  it('cut G1 S values match the default 30% layer power', () => {
    const p = curveProject();
    const want = expectedS(30, p.device.maxPowerS);
    for (const s of collectG1SValues(emitGcode(p).gcode)) expect(s).toBe(want);
  });
});
