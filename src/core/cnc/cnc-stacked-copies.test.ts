// Meta audit M7-P2-2 (the 2026-09-29 CNC pass's P2-toolpath-3, ADR-359
// Amendment 3): a closed shape stacked on its exact copy was not cut at all.
// The filled cut types fill closed outlines even-odd, so the identical pair
// enclosed nothing, while the control shape beside it was cut normally. Each
// case compares the stacked project with the same project holding one copy.

import { describe, expect, it } from 'vitest';
import { cncOmissionArtwork, cncOmissionProject } from '../../__fixtures__/cnc-open-contours';
import { cncPassXyPoints, type Job } from '../job/job';
import { runCncPreflight } from '../preflight/cnc-preflight';
import {
  DEFAULT_CNC_MACHINE_CONFIG,
  type CncCutType,
  type CncMachineConfig,
  type CncTool,
  type ImportedSvg,
  type Project,
} from '../scene';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { partitionEmitPreflight } from '../../ui/laser/start-job-readiness-policy';
import { compileCncJob } from './compile-cnc-job';
import type { CollectedCncContour } from './cnc-manual-tab-mapping';
import { mergeStackedClosedContours } from './cnc-stacked-copies';

const VBIT_90: CncTool = {
  id: 'v90',
  name: '90° v-bit',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 90,
};
const FILLED_CUT_TYPES: ReadonlyArray<CncCutType> = [
  'profile-outside',
  'profile-inside',
  'pocket',
  'v-carve',
  'inlay-pair',
];
const STACKED_CODE = 'cnc-stacked-copies-merged';

const SQUARE = cncOmissionArtwork('square', true, 10);
const SQUARE_COPY = cncOmissionArtwork('square-copy', true, 10);
const CONTROL = cncOmissionArtwork('control', true, 40);

function config(cutType: CncCutType): CncMachineConfig {
  return cutType === 'v-carve'
    ? { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [VBIT_90], toolId: VBIT_90.id }
    : DEFAULT_CNC_MACHINE_CONFIG;
}

function compile(objects: ReadonlyArray<ImportedSvg>, cutType: CncCutType): Job {
  const project = cncOmissionProject([...objects], cutType);
  return compileCncJob(project.scene, project.device, config(cutType));
}

function cutPointsNear(job: Job, minX: number, maxX: number): number {
  return job.groups
    .flatMap((group) =>
      group.kind === 'cnc' ? group.passes.flatMap((pass) => cncPassXyPoints(pass)) : [],
    )
    .filter((point) => point.x > minX && point.x < maxX).length;
}

/** One SVG object that draws its square twice, as a doubled path does. */
function doubledSquare(): ImportedSvg {
  const path = SQUARE.paths[0]!;
  return { ...SQUARE, paths: [{ ...path, polylines: [path.polylines[0]!, path.polylines[0]!] }] };
}

function preflight(project: Project, job: Job) {
  return runCncPreflight(project, DEFAULT_CNC_MACHINE_CONFIG, emitGcode(project).gcode, {
    compiledJob: job,
    sourceGeometryChecks: 'compiled-evidence-only',
  });
}

// Each V-carve case plans the medial axis twice, which outgrows the 5 s default
// on a loaded runner.
describe('stacked exact copies on a filled CNC cut', { timeout: 30_000 }, () => {
  for (const cutType of FILLED_CUT_TYPES) {
    it(`${cutType}: cuts two stacked objects exactly as it cuts one`, () => {
      const single = compile([SQUARE, CONTROL], cutType);
      const stacked = compile([SQUARE, SQUARE_COPY, CONTROL], cutType);
      // The repro: before the merge the pair got no motion at all.
      expect(cutPointsNear(single, 0, 30)).toBeGreaterThan(0);
      expect(cutPointsNear(stacked, 0, 30)).toBe(cutPointsNear(single, 0, 30));
      expect(stacked.groups).toEqual(single.groups);
      expect(stacked.cncCompilation?.mergedStackedCopies).toEqual([
        { layerId: 'pocket-main', cutType, count: 1 },
      ]);
      expect(single.cncCompilation?.mergedStackedCopies).toBeUndefined();
    });
  }

  it('merges a path an SVG draws twice inside one object', () => {
    const stacked = compile([doubledSquare(), CONTROL], 'pocket');
    expect(stacked.groups).toEqual(compile([SQUARE, CONTROL], 'pocket').groups);
    expect(stacked.cncCompilation?.mergedStackedCopies).toEqual([
      { layerId: 'pocket-main', cutType: 'pocket', count: 1 },
    ]);
  });

  it('counts every extra copy of a three-high stack', () => {
    const third = cncOmissionArtwork('square-third', true, 10);
    const stacked = compile([SQUARE, SQUARE_COPY, third, CONTROL], 'profile-outside');
    expect(stacked.cncCompilation?.mergedStackedCopies).toEqual([
      { layerId: 'pocket-main', cutType: 'profile-outside', count: 2 },
    ]);
  });

  it('merges a copy drawn from another corner and in the other direction', () => {
    const points = SQUARE.paths[0]!.polylines[0]!.points;
    const turned: ImportedSvg = {
      ...SQUARE_COPY,
      paths: [
        {
          ...SQUARE.paths[0]!,
          // Starts at the far corner, runs clockwise and repeats its start.
          polylines: [
            { closed: true, points: [points[2]!, points[1]!, points[0]!, points[3]!, points[2]!] },
          ],
        },
      ],
    };
    const stacked = compile([SQUARE, turned, CONTROL], 'pocket');
    expect(cutPointsNear(stacked, 0, 30)).toBe(
      cutPointsNear(compile([SQUARE, CONTROL], 'pocket'), 0, 30),
    );
    expect(stacked.cncCompilation?.mergedStackedCopies?.[0]?.count).toBe(1);
  });

  it('keeps a near copy, which is not the same outline at the 0.001 mm output resolution', () => {
    const near: ImportedSvg = { ...SQUARE_COPY, transform: { ...SQUARE_COPY.transform, x: 0.01 } };
    expect(
      compile([SQUARE, near, CONTROL], 'pocket').cncCompilation?.mergedStackedCopies,
    ).toBeUndefined();
  });

  it('keeps both copies on cut types that follow the line, where a copy is cut again', () => {
    for (const cutType of ['profile-on-path', 'engrave', 'drill'] as const) {
      const single = compile([SQUARE, CONTROL], cutType);
      const stacked = compile([SQUARE, SQUARE_COPY, CONTROL], cutType);
      expect(cutPointsNear(stacked, 0, 30)).toBe(2 * cutPointsNear(single, 0, 30));
      expect(stacked.cncCompilation?.mergedStackedCopies).toBeUndefined();
    }
  });

  it('says so in Job Review as a warning, never a block', () => {
    const project = cncOmissionProject([SQUARE, SQUARE_COPY, CONTROL], 'pocket');
    const job = compileCncJob(project.scene, project.device, DEFAULT_CNC_MACHINE_CONFIG);
    const result = preflight(project, job);
    const notes = result.issues.filter((issue) => issue.code === STACKED_CODE);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.message).toContain('pocket-main');
    expect(notes[0]?.message).toContain('cut once');
    const partition = partitionEmitPreflight(result);
    expect(partition.blocking.some((message) => message.includes('cut once'))).toBe(false);
    expect(partition.warnings.some((message) => message.includes('cut once'))).toBe(true);
    const single = cncOmissionProject([SQUARE, CONTROL], 'pocket');
    const singleJob = compileCncJob(single.scene, single.device, DEFAULT_CNC_MACHINE_CONFIG);
    expect(preflight(single, singleJob).issues.some((issue) => issue.code === STACKED_CODE)).toBe(
      false,
    );
  });
});

describe('mergeStackedClosedContours', () => {
  const layer = cncOmissionProject([], 'pocket').scene.layers[0]!;
  const ring = SQUARE.paths[0]!.polylines[0]!;

  it('keeps the manual tabs of every merged copy on the outline it keeps', () => {
    const contours: CollectedCncContour[] = [
      { polyline: ring, objectId: 'a', manualTabPoints: [{ x: 15, y: 10 }] },
      {
        polyline: ring,
        objectId: 'b',
        manualTabPoints: [
          { x: 15, y: 10 },
          { x: 20, y: 15 },
        ],
      },
    ];
    expect(mergeStackedClosedContours(layer, contours)).toEqual([
      {
        polyline: ring,
        objectId: 'a',
        manualTabPoints: [
          { x: 15, y: 10 },
          { x: 20, y: 15 },
        ],
        stackedCopies: 1,
      },
    ]);
  });

  it('merges nonzero copies only when they run the same way, as Delete Duplicates does', () => {
    const reversed = { ...ring, points: [...ring.points].reverse() };
    const same: CollectedCncContour[] = [
      { polyline: ring, fillRule: 'nonzero' },
      { polyline: ring, fillRule: 'nonzero' },
    ];
    const opposite: CollectedCncContour[] = [
      { polyline: ring, fillRule: 'nonzero' },
      { polyline: reversed, fillRule: 'nonzero' },
    ];
    expect(mergeStackedClosedContours(layer, same)).toHaveLength(1);
    expect(mergeStackedClosedContours(layer, opposite)).toEqual(opposite);
  });

  it('leaves open copies alone: an open outline encloses nothing to cancel', () => {
    const open = { ...ring, closed: false };
    const contours: CollectedCncContour[] = [{ polyline: open }, { polyline: open }];
    expect(mergeStackedClosedContours(layer, contours)).toEqual(contours);
  });
});
