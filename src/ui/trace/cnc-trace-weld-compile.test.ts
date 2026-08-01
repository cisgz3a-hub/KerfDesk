import { describe, expect, it } from 'vitest';
import { compileCncJob } from '../../core/cnc';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { CncContourPass, CncPass } from '../../core/job';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Polyline,
  type Scene,
  type TracedImage,
} from '../../core/scene';
import { fairTracedPathsForCnc } from './cnc-trace-fairing';

const TRACE_COLOR = '#000000';
const OPERATION_ID = 'trace-engrave';
const TRACE_ID = 'independent-strokes';
const TRACE_SOURCE = 'independent-strokes.png';
const TRACE_SCALE_MM_PER_PX = 0.1;
const STROKE_LENGTH_PX = 100;
const STROKE_SEPARATION_PX = 4;
const EXPECTED_STROKE_LENGTH_MM = 10;
const EXPECTED_STROKE_SEPARATION_MM = 0.4;
const COORDINATE_PRECISION = 6;
const CUT_DEPTH_MM = 1;

const INDEPENDENT_STROKES: ReadonlyArray<Polyline> = [
  {
    closed: false,
    points: [
      { x: 0, y: 0 },
      { x: STROKE_LENGTH_PX, y: 0 },
    ],
  },
  {
    closed: false,
    points: [
      { x: 0, y: STROKE_SEPARATION_PX },
      { x: STROKE_LENGTH_PX, y: STROKE_SEPARATION_PX },
    ],
  },
];

function contourPass(pass: CncPass): CncContourPass {
  if (pass.kind !== 'contour') throw new Error('expected a contour pass');
  return pass;
}

function span(values: ReadonlyArray<number>): number {
  return Math.max(...values) - Math.min(...values);
}

describe('CNC trace weld compile integrity', () => {
  it('keeps nearby independent strokes as separate open contour passes', () => {
    const transform = {
      ...IDENTITY_TRANSFORM,
      scaleX: TRACE_SCALE_MM_PER_PX,
      scaleY: TRACE_SCALE_MM_PER_PX,
    };
    const paths = fairTracedPathsForCnc(
      [{ color: TRACE_COLOR, polylines: INDEPENDENT_STROKES }],
      transform,
    );
    expect(paths[0]?.polylines).toHaveLength(2);
    expect(paths[0]?.polylines.every((polyline) => !polyline.closed)).toBe(true);
    expect(paths[0]?.curves).toHaveLength(2);

    const traced: TracedImage = {
      kind: 'traced-image',
      id: TRACE_ID,
      source: TRACE_SOURCE,
      bounds: {
        minX: 0,
        minY: 0,
        maxX: STROKE_LENGTH_PX,
        maxY: STROKE_SEPARATION_PX,
      },
      transform,
      paths,
      operationIds: [OPERATION_ID],
    };
    const scene: Scene = {
      objects: [traced],
      layers: [
        {
          ...createLayer({ id: OPERATION_ID, color: TRACE_COLOR }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'engrave',
            depthMm: CUT_DEPTH_MM,
            depthPerPassMm: CUT_DEPTH_MM,
            tabsEnabled: false,
          },
        },
      ],
    };
    const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
    expect(job.groups).toHaveLength(1);
    const group = job.groups[0];
    if (group?.kind !== 'cnc') throw new Error('expected one CNC group');
    expect(group.passes).toHaveLength(2);
    const passes = group.passes.map(contourPass);
    expect(passes.every((pass) => !pass.closed)).toBe(true);
    expect(passes.map((pass) => span(pass.polyline.map((point) => point.x)))).toEqual([
      expect.closeTo(EXPECTED_STROKE_LENGTH_MM, COORDINATE_PRECISION),
      expect.closeTo(EXPECTED_STROKE_LENGTH_MM, COORDINATE_PRECISION),
    ]);
    expect(passes.every((pass) => span(pass.polyline.map((point) => point.y)) === 0)).toBe(true);
    const yLevels = passes.map((pass) => pass.polyline[0]?.y);
    const firstY = yLevels[0];
    const secondY = yLevels[1];
    if (firstY === undefined || secondY === undefined) {
      throw new Error('expected each contour pass to have a starting point');
    }
    expect(Math.abs(secondY - firstY)).toBeCloseTo(
      EXPECTED_STROKE_SEPARATION_MM,
      COORDINATE_PRECISION,
    );
  });
});
