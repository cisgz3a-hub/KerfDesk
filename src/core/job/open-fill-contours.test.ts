import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type TracedImage,
} from '../scene';
import { runPreflight } from '../preflight';
import { emitGcode } from '../../io/gcode/emit-gcode';
import * as materialization from './compilation-polylines';
import { openFillContours } from './open-fill-contours';

afterEach(() => vi.restoreAllMocks());

describe('canonical open Fill query on closed traces', () => {
  it('dismisses a dense closed canonical trace without flattening stale open compatibility data', () => {
    const project = traceProject([denseClosedCurve()]);
    const flatten = vi.spyOn(materialization, 'compilationPolylines');

    expect(openFillContours(project.scene)).toEqual([]);
    expect(runPreflight(project, 'G1 X1 Y1 S10').issues).not.toContainEqual(
      expect.objectContaining({ code: 'offset-fill-open-contour' }),
    );
    expect(flatten).not.toHaveBeenCalled();
  });

  it('materializes only the open canonical sibling and keeps its original pair index', () => {
    const open: CurveSubpath = {
      start: { x: 30, y: 0 },
      segments: [
        {
          kind: 'cubic',
          control1: { x: 40, y: 0 },
          control2: { x: 40, y: 10 },
          to: { x: 30, y: 10 },
        },
        { kind: 'line', to: { x: 30.25, y: 0.25 } },
      ],
      closed: false,
    };
    const project = traceProject([denseClosedCurve(), open]);
    const flatten = vi.spyOn(materialization, 'compilationPolylines');

    const groups = openFillContours(project.scene);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.contourIndexes).toEqual([1]);
    expect(groups[0]?.polylines).toHaveLength(1);
    expect(groups[0]?.polylines[0]?.points.length).toBeGreaterThan(3);
    expect(flatten).toHaveBeenCalledTimes(1);
    expect(flatten.mock.calls[0]?.[0].curves).toEqual([open]);
  });

  it('does not label a closed degenerate contour as open when output is empty for a different reason', () => {
    const degenerate: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [{ kind: 'line', to: { x: 10, y: 0 } }],
      closed: true,
    };
    const project = traceProject([degenerate]);

    const emitted = emitGcode(project);

    expect(openFillContours(project.scene)).toEqual([]);
    expect(emitted.preflight.issues.map((issue) => issue.code)).toContain('empty-output');
    expect(emitted.preflight.issues.map((issue) => issue.code)).not.toContain(
      'offset-fill-open-contour',
    );
  });
});

function traceProject(curves: ReadonlyArray<CurveSubpath>) {
  const object: TracedImage = {
    kind: 'traced-image',
    id: 'dense-trace',
    source: 'dense-trace.png',
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
    paths: [
      {
        color: '#000000',
        curves,
        polylines: curves.map((curve) => ({
          closed: false,
          points: [curve.start, curve.segments.at(-1)?.to ?? curve.start],
        })),
      },
    ],
  };
  return {
    ...createProject(),
    scene: {
      objects: [object],
      layers: [createLayer({ id: 'fill', color: '#000000', mode: 'fill' })],
      groups: [],
    },
  };
}

function denseClosedCurve(): CurveSubpath {
  const count = 6000;
  const point = (index: number) => ({
    x: 10 + 10 * Math.cos((2 * Math.PI * index) / count),
    y: 10 + 10 * Math.sin((2 * Math.PI * index) / count),
  });
  return {
    start: point(0),
    segments: Array.from({ length: count }, (_, index) => ({
      kind: 'cubic' as const,
      control1: point(index),
      control2: point(index + 1),
      to: index + 1 === count ? point(0) : point(index + 1),
    })),
    closed: true,
  };
}
