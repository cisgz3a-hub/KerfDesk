import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
  type Project,
  type Vec2,
} from '../../core/scene';
import type { PathNodeRef } from '../state/path-node-edit-actions';
import { snapExclusionForDrag, snapPathNodePoint, snapTargetKey } from './path-node-snap';
import { DEFAULT_SNAP_SETTINGS } from './snapping';

const SQUARE: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'line', to: { x: 10, y: 0 } },
    { kind: 'line', to: { x: 10, y: 10 } },
    { kind: 'line', to: { x: 0, y: 10 } },
  ],
  closed: true,
};

describe('snapExclusionForDrag', () => {
  it('leaves out a dragged node and both segments it bends, across the closing edge', () => {
    const project = withPaths([curved(SQUARE)]);
    const exclusion = snapExclusionForDrag(project, node(0), [node(0)]);
    expect([...exclusion.nodes]).toEqual([key(0)]);
    expect([...exclusion.segments].sort()).toEqual([key(0), key(3)].sort());
  });

  it('keeps a handle’s own node as a target but not the segments the handle shapes', () => {
    const project = withPaths([curved(SQUARE)]);
    const exclusion = snapExclusionForDrag(project, { ...node(2), handle: 'outgoing' }, []);
    expect(exclusion.nodes.size).toBe(0);
    expect([...exclusion.segments].sort()).toEqual([key(1), key(2)].sort());
  });
});

describe('snapPathNodePoint', () => {
  const none = { nodes: new Set<string>(), segments: new Set<string>() };

  it('snaps to nodes and segment midpoints, including the implicit closing edge', () => {
    const project = withPaths([curved(SQUARE)]);
    const snap = (point: Vec2) =>
      snapPathNodePoint({ project, point, settings: DEFAULT_SNAP_SETTINGS, exclusion: none });
    expect(snap({ x: 9, y: 11 }).target).toEqual({ x: 10, y: 10 });
    expect(snap({ x: 0.5, y: 4.2 }).target).toEqual({ x: 0, y: 5 });
  });

  it('never offers artwork on hidden layers', () => {
    const hidden: ColoredPath = { ...curved(SQUARE), color: '#ff0000' };
    const project = withPaths(
      [hidden],
      [{ ...createLayer({ id: '#ff0000', color: '#ff0000' }), visible: false }],
    );
    const settings = { ...DEFAULT_SNAP_SETTINGS, snapToGrid: false };
    const result = snapPathNodePoint({
      project,
      point: { x: 9, y: 11 },
      settings,
      exclusion: none,
    });
    expect(result).toEqual({ point: { x: 9, y: 11 }, guides: [], target: null });
  });

  it('falls back to the grid, one axis at a time, with guides across the bed', () => {
    const project = withPaths([]);
    const settings = { ...DEFAULT_SNAP_SETTINGS, gridMm: 10, distanceMm: 1 };
    const result = snapPathNodePoint({
      project,
      point: { x: 29.4, y: 44 },
      settings,
      exclusion: none,
    });
    expect(result.point).toEqual({ x: 30, y: 44 });
    expect(result.guides).toEqual([
      { axis: 'x', positionMm: 30, fromMm: 0, toMm: project.device.bedHeight },
    ]);
  });

  it('does nothing while snapping is switched off', () => {
    const project = withPaths([curved(SQUARE)]);
    const settings = { ...DEFAULT_SNAP_SETTINGS, enabled: false };
    const result = snapPathNodePoint({
      project,
      point: { x: 9, y: 11 },
      settings,
      exclusion: none,
    });
    expect(result.target).toBeNull();
    expect(result.point).toEqual({ x: 9, y: 11 });
  });
});

function node(pointIndex: number): PathNodeRef {
  return { objectId: 'art', pathIndex: 0, polylineIndex: 0, pointIndex, geometry: 'curve' };
}

function key(index: number): string {
  return snapTargetKey('art', 0, 0, index);
}

function curved(curve: CurveSubpath): ColoredPath {
  return {
    color: '#000000',
    polylines: [
      { points: [curve.start, ...curve.segments.map((s) => s.to)], closed: curve.closed },
    ],
    curves: [curve],
  };
}

function withPaths(
  paths: ReadonlyArray<ColoredPath>,
  extraLayers: ReadonlyArray<ReturnType<typeof createLayer>> = [],
): Project {
  const art: ImportedSvg = {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths,
  };
  return {
    ...createProject(),
    scene: {
      objects: paths.length === 0 ? [] : [art],
      layers: [createLayer({ id: '#000000', color: '#000000' }), ...extraLayers],
      groups: [],
    },
  };
}
