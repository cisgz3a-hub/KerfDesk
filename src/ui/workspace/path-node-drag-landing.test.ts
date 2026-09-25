import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type Project,
  type Vec2,
} from '../../core/scene';
import type { PathNodeRef } from '../state/path-node-edit-actions';
import { constrainToOctant, joinCueAt, nodeDragLanding } from './path-node-drag-landing';
import { DEFAULT_SNAP_SETTINGS } from './snapping';

describe('constrainToOctant', () => {
  it('holds level and upright moves exactly on the start line', () => {
    expect(constrainToOctant({ x: 1, y: 1 }, { x: 5, y: 1.3 })).toEqual({ x: 5, y: 1 });
    expect(constrainToOctant({ x: 1, y: 1 }, { x: 1.2, y: -7 })).toEqual({ x: 1, y: -7 });
  });

  it('projects onto the diagonal nearest the pointer', () => {
    const point = constrainToOctant({ x: 0, y: 0 }, { x: -4, y: 4.2 });
    expect(point.x).toBeCloseTo(-4.1, 12);
    expect(point.y).toBeCloseTo(4.1, 12);
  });
});

describe('joinCueAt', () => {
  const cueFor = (
    project: Project,
    grabbed: PathNodeRef,
    proposed: Vec2,
    moving: ReadonlyArray<PathNodeRef> = [grabbed],
  ) => joinCueAt({ project, grabbed, moving, proposed, pxToMm: 0.1 });

  it('offers the nearest other open end of the same path within reach', () => {
    const project = withArtwork([line([0, 10]), line([12, 20]), line([10.5, 30])]);
    const cue = cueFor(project, node(0, 1), { x: 10.4, y: 0.1 });
    expect(cue?.target).toEqual({ ...node(2, 0) });
    expect(cue?.point).toEqual({ x: 10.5, y: 0 });
    expect(cueFor(project, node(0, 1), { x: 11.5, y: 0 })?.target).toEqual(node(1, 0));
    expect(cueFor(project, node(0, 1), { x: 11, y: 3 })).toBeNull();
  });

  it('closes a subpath on itself only when that encloses something', () => {
    const project = withArtwork([line([0, 10]), line([0, 10, 20], [5, 5, 15])]);
    expect(cueFor(project, node(0, 1), { x: 0, y: 0.2 })).toBeNull();
    expect(cueFor(project, node(1, 2), { x: 0.2, y: 5 })?.target).toEqual(node(1, 0));
  });

  it('ignores interior nodes, handles and multi-node moves', () => {
    const project = withArtwork([line([0, 10, 20]), line([30, 40])]);
    expect(cueFor(project, node(0, 1), { x: 30, y: 0 })).toBeNull();
    expect(cueFor(project, { ...node(0, 2), handle: 'incoming' }, { x: 30, y: 0 })).toBeNull();
    expect(cueFor(project, node(0, 2), { x: 30, y: 0 }, [node(0, 2), node(0, 1)])).toBeNull();
  });
});

describe('nodeDragLanding', () => {
  it('lets a join win over the Shift constraint and snapping', () => {
    const project = withArtwork([line([0, 10]), line([12, 20])]);
    const landing = nodeDragLanding({
      project,
      grabbed: node(0, 1),
      moving: [node(0, 1)],
      origin: { x: 10, y: 0 },
      proposed: { x: 12.1, y: 0.3 },
      pxToMm: 0.1,
      constrain: true,
      snap: DEFAULT_SNAP_SETTINGS,
    });
    expect(landing.point).toEqual({ x: 12, y: 0 });
    expect(landing.feedback.join?.target).toEqual(node(1, 0));
    expect(landing.feedback.constraint).toBeNull();
  });
});

function node(polylineIndex: number, pointIndex: number): PathNodeRef {
  return { objectId: 'art', pathIndex: 0, polylineIndex, pointIndex, geometry: 'curve' };
}

function line(xs: ReadonlyArray<number>, ys: ReadonlyArray<number> = []): CurveSubpath {
  const at = (index: number): Vec2 => ({ x: xs[index] ?? 0, y: ys[index] ?? 0 });
  return {
    start: at(0),
    segments: xs.slice(1).map((_, index) => ({ kind: 'line' as const, to: at(index + 1) })),
    closed: false,
  };
}

function withArtwork(curves: ReadonlyArray<CurveSubpath>): Project {
  const art: ImportedSvg = {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 15 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: curves.map((curve) => ({
          points: [curve.start, ...curve.segments.map((segment) => segment.to)],
          closed: curve.closed,
        })),
        curves,
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
