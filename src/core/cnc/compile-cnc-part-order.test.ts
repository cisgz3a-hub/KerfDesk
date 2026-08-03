// End-to-end pin for part-major profile ordering (the Drive/Safe field
// incident, 2026-08-01): with two letter-like shapes on one layer, the
// compiled pass sequence must run the first letter's counter ladder, then its
// outer ladder, then move to the second letter — never all counters across
// the scene first.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type ImportedSvg,
  type Polyline,
  type Scene,
} from '../scene';
import type { CncContourPass, CncPass } from '../job';
import { contourPassFromPolyline } from './compile-cnc-helpers';
import { compileCncJob } from './compile-cnc-job';
import { profilePassesWithFinishAllowance } from './finish-allowance';
import { profileToolpathPolylines } from './profile-paths';

const dev = DEFAULT_DEVICE_PROFILE;
const config = DEFAULT_CNC_MACHINE_CONFIG;

function ring(atX: number, atY: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: atX, y: atY },
      { x: atX + size, y: atY },
      { x: atX + size, y: atY + size },
      { x: atX, y: atY + size },
    ],
  };
}

function rectangle(minX: number, minY: number, maxX: number, maxY: number): Polyline {
  return {
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
  };
}

function contourPass(pass: CncPass): CncContourPass {
  if (pass.kind !== 'contour') throw new Error('expected a contour pass');
  return pass;
}

function passPoints(pass: CncPass): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  if (pass.kind === 'contour') return pass.polyline;
  if (pass.kind === 'path3d') return pass.points;
  return [];
}

function passLetter(pass: CncPass): 'A' | 'B' {
  const xs = passPoints(pass).map((point) => point.x);
  if (xs.length === 0) throw new Error('expected a geometric pass');
  return (Math.min(...xs) + Math.max(...xs)) / 2 < 30 ? 'A' : 'B';
}

// Two "letters": outer 20 mm rings with 8 mm counters. The counters sit
// 6 mm inside their outers, far wider than the 3.175 mm bit, so ADR-218
// line-art pairing never fires on them.
const letterA = { outer: ring(0, 0, 20), hole: ring(6, 6, 8) };
const letterB = { outer: ring(40, 0, 20), hole: ring(46, 6, 8) };

const scene: Scene = {
  layers: [
    {
      ...createLayer({ id: 'L1', color: '#ff0000' }),
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'profile-on-path',
        depthMm: 2,
        depthPerPassMm: 1,
        tabsEnabled: false,
      },
    },
  ],
  objects: [
    {
      kind: 'imported-svg',
      id: 'letters',
      source: 'letters.svg',
      bounds: { minX: 0, minY: 0, maxX: 60, maxY: 20 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#ff0000',
          polylines: [letterA.outer, letterA.hole, letterB.outer, letterB.hole],
        },
      ],
    } satisfies ImportedSvg,
  ],
};

describe('compileCncJob profile part order', () => {
  it('finishes one letter (counter, then outer, at every depth) before the next', () => {
    const job = compileCncJob(scene, dev, config);
    expect(job.groups).toHaveLength(1);
    const group = job.groups[0];
    if (group?.kind !== 'cnc') throw new Error('expected a cnc group');

    // Label each contour pass by the min X of its ring: counters start 6 mm
    // right of their outers, so minX identifies the contour unambiguously.
    const sequence = group.passes.map((pass) => {
      const polyline = contourPass(pass).polyline;
      const minX = Math.min(...polyline.map((point) => point.x));
      const zMm = contourPass(pass).zMm;
      return { minX, zMm };
    });

    expect(sequence).toEqual([
      { minX: 6, zMm: -1 },
      { minX: 6, zMm: -2 },
      { minX: 0, zMm: -1 },
      { minX: 0, zMm: -2 },
      { minX: 46, zMm: -1 },
      { minX: 46, zMm: -2 },
      { minX: 40, zMm: -1 },
      { minX: 40, zMm: -2 },
    ]);
  });

  it('clears every depth of one pocket letter before travelling to the next', () => {
    const pocketScene: Scene = {
      ...scene,
      layers: scene.layers.map((layer) => ({
        ...layer,
        cnc: {
          ...(layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS),
          cutType: 'pocket' as const,
          stepoverPercent: 40,
        },
      })),
    };
    const job = compileCncJob(pocketScene, dev, config);
    const group = job.groups[0];
    if (group?.kind !== 'cnc') throw new Error('expected a cnc group');
    const sequence = group.passes.map((pass) => {
      const contour = contourPass(pass);
      const minX = Math.min(...contour.polyline.map((point) => point.x));
      return { letter: minX < 30 ? 'A' : 'B', zMm: contour.zMm } as const;
    });
    expect(compress(sequence.map(({ letter }) => letter))).toEqual(['A', 'B']);
    for (const letter of ['A', 'B'] as const) {
      expect(
        compress(sequence.filter((entry) => entry.letter === letter).map(({ zMm }) => zMm)),
      ).toEqual([-1, -2]);
    }
  });

  it('roughs and finish-cuts one profile letter before starting the next', () => {
    const finishScene: Scene = {
      ...scene,
      layers: scene.layers.map((layer) => ({
        ...layer,
        cnc: {
          ...(layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS),
          cutType: 'profile-outside' as const,
          finishAllowanceMm: 0.5,
        },
      })),
    };
    const job = compileCncJob(finishScene, dev, config);
    const group = job.groups[0];
    if (group?.kind !== 'cnc') throw new Error('expected a cnc group');

    expect(compress(group.passes.map(passLetter))).toEqual(['A', 'B']);
    expect(group.passes.filter((pass) => passLetter(pass) === 'A')).toHaveLength(6);
    expect(group.passes.filter((pass) => passLetter(pass) === 'B')).toHaveLength(6);
  });

  it('keeps finish ownership when a thin source part disappears from only the rough offset', () => {
    const upperThin = rectangle(0, 100, 100, 104);
    const lowerSquare = rectangle(0, 0, 10, 10);
    const sources = [upperThin, lowerSquare];
    const settings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-inside' as const,
      depthMm: 2,
      depthPerPassMm: 1,
      finishAllowanceMm: 1,
      tabsEnabled: false,
    };
    const roughing = profileToolpathPolylines(sources, 'inside', 3, 1);
    expect(roughing).toHaveLength(1);

    const passes = profilePassesWithFinishAllowance(sources, settings, 3, roughing, 1, [], (part) =>
      part.flatMap((polyline) => [-1, -2].map((zMm) => contourPassFromPolyline(polyline, zMm))),
    );
    const owners = passes.map((pass) => {
      const ys = passPoints(pass).map(({ y }) => y);
      return (Math.min(...ys) + Math.max(...ys)) / 2 > 50 ? 'upper' : 'lower';
    });

    expect(compress(owners)).toEqual(['upper', 'lower']);
    expect(owners).toEqual(['upper', 'lower', 'lower', 'lower']);
  });

  it('ignores an open envelope when grouping closed pocket letters', () => {
    const openEnvelope: Polyline = {
      closed: false,
      points: [
        { x: -10, y: -10 },
        { x: 70, y: -10 },
        { x: 70, y: 30 },
        { x: -10, y: 30 },
      ],
    };
    const mixedScene: Scene = {
      ...scene,
      layers: scene.layers.map((layer) => ({
        ...layer,
        cnc: {
          ...(layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS),
          cutType: 'pocket' as const,
          stepoverPercent: 40,
        },
      })),
      objects: scene.objects.map((object) =>
        object.kind !== 'imported-svg'
          ? object
          : {
              ...object,
              paths: object.paths.map((path) => ({
                ...path,
                polylines: [openEnvelope, ...path.polylines],
              })),
            },
      ),
    };
    const job = compileCncJob(mixedScene, dev, config);
    const group = job.groups[0];
    if (group?.kind !== 'cnc') throw new Error('expected a cnc group');

    expect(compress(group.passes.map(passLetter))).toEqual(['A', 'B']);
  });
});

function compress<T>(values: ReadonlyArray<T>): ReadonlyArray<T> {
  return values.filter((value, index) => index === 0 || value !== values[index - 1]);
}
