import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import type { PathSegmentRef } from '../state/path-segment-ref';
import { canvasTheme } from '../theme/canvas-theme';
import { drawNodeEditOverlay } from './draw-node-edit-overlay';
import type { NodeDragFeedback } from './node-edit-store';
import type { ViewTransform } from './view-transform';

type Call = {
  readonly name: string;
  readonly args: ReadonlyArray<unknown>;
  readonly color: unknown;
};

const VIEW: ViewTransform = { scale: 2, offsetX: 10, offsetY: 20 };

const CURVE: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'cubic', control1: { x: 0, y: 5 }, control2: { x: 10, y: 5 }, to: { x: 10, y: 0 } },
    { kind: 'line', to: { x: 20, y: 0 } },
  ],
  closed: false,
};

describe('drawNodeEditOverlay', () => {
  it('traces a hovered curve exactly where the placed artwork sits', () => {
    const { ctx, calls } = recordingContext();
    drawNodeEditOverlay(ctx, {
      project: withArt(),
      view: VIEW,
      hover: {
        kind: 'segment',
        hit: { ref: segment(0), t: 0.5, point: { x: 10, y: 3.75 }, distanceMm: 0 },
      },
      selectedSegment: null,
      feedback: null,
    });

    // The artwork sits 5 mm right of its local origin.
    expect(named(calls, 'moveTo')).toEqual([[20, 20]]);
    expect(named(calls, 'bezierCurveTo')).toEqual([[20, 30, 40, 30, 40, 20]]);
    expect(strokes(calls)).toEqual([canvasTheme.pathSegmentHover]);
  });

  it('keeps the clicked segment marked while a node is hovered', () => {
    const { ctx, calls } = recordingContext();
    drawNodeEditOverlay(ctx, {
      project: withArt(),
      view: VIEW,
      hover: { kind: 'node', ref: { ...node(0) } },
      selectedSegment: segment(1),
      feedback: null,
    });

    expect(named(calls, 'moveTo')).toEqual([[40, 20]]);
    expect(named(calls, 'lineTo')).toEqual([[60, 20]]);
    expect(named(calls, 'arc')[0]?.slice(0, 2)).toEqual([20, 20]);
    expect(strokes(calls)).toEqual([canvasTheme.pathSegmentSelected, canvasTheme.pathSegmentHover]);
  });

  it('draws nothing for a segment that no longer exists', () => {
    const { ctx, calls } = recordingContext();
    drawNodeEditOverlay(ctx, {
      project: withArt(),
      view: VIEW,
      hover: null,
      selectedSegment: segment(7),
      feedback: null,
    });
    expect(calls.filter((call) => call.name === 'stroke')).toEqual([]);
  });

  it('shows the join target, the snap target and the Shift guide of a drag', () => {
    const feedback: NodeDragFeedback = {
      join: { dragged: node(2), target: node(0), point: { x: 0, y: 0 } },
      snapPoint: { x: 10, y: 10 },
      constraint: { from: { x: 0, y: 0 }, to: { x: 10, y: 0 } },
    };
    const { ctx, calls } = recordingContext();
    drawNodeEditOverlay(ctx, {
      project: withArt(),
      view: VIEW,
      hover: null,
      selectedSegment: null,
      feedback,
    });

    expect(named(calls, 'setLineDash')).toEqual([[[4, 4]]]);
    // The guide crosses the whole canvas; the snap diamond starts at its top.
    expect(named(calls, 'moveTo')).toEqual([
      [-490, 20],
      [30, 35],
    ]);
    expect(named(calls, 'arc').map((args) => args.slice(0, 3))).toEqual([
      [10, 20, 10],
      [10, 20, 5],
    ]);
    expect(strokes(calls)).toEqual([
      canvasTheme.snapGuide,
      canvasTheme.snapGuide,
      canvasTheme.pathNodeJoinCue,
      canvasTheme.pathNodeJoinCue,
    ]);
  });
});

function recordingContext(): { readonly ctx: CanvasRenderingContext2D; readonly calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string | symbol, unknown> = { canvas: { width: 400, height: 300 } };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args: ReadonlyArray<unknown>) => {
        calls.push({ name: String(prop), args, color: target.strokeStyle });
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function named(calls: ReadonlyArray<Call>, name: string): ReadonlyArray<ReadonlyArray<unknown>> {
  return calls.filter((call) => call.name === name).map((call) => call.args);
}

function strokes(calls: ReadonlyArray<Call>): ReadonlyArray<unknown> {
  return calls.filter((call) => call.name === 'stroke').map((call) => call.color);
}

function segment(segmentIndex: number): PathSegmentRef {
  return { objectId: 'art', pathIndex: 0, polylineIndex: 0, segmentIndex };
}

function node(pointIndex: number) {
  return {
    objectId: 'art',
    pathIndex: 0,
    polylineIndex: 0,
    pointIndex,
    geometry: 'curve' as const,
  };
}

function withArt(): Project {
  const art: ImportedSvg = {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 5, minY: 0, maxX: 25, maxY: 3.75 },
    transform: { ...IDENTITY_TRANSFORM, x: 5 },
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 20, y: 0 },
            ],
            closed: false,
          },
        ],
        curves: [CURVE],
      },
    ],
  };
  return {
    ...createProject(),
    scene: {
      objects: [art],
      layers: [createLayer({ id: '#000000', color: '#000000' })],
      groups: [],
    },
  };
}
