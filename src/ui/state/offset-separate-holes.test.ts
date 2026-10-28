// Rolling audit v7 L1-P1-1 through the real store actions and the compiled job
// (ADR-410 Amendment 3). A hole drawn with the Rectangle or Ellipse tool inside a
// plate is a hole of the offset, so Delete original objects no longer takes it
// out of the burn, and the Offset outlines row offsets it too.

import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileJob } from '../../core/job';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Scene,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { createEllipse, createRectangle } from '../../core/shapes/primitives';
import type { OffsetShapesRequest } from './offset-shapes-actions';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const COLOR = '#222222';

function rectangle(id: string, x: number, y: number, width: number, height: number): SceneObject {
  const spec = { widthMm: width, heightMm: height, cornerRadiusMm: 0 };
  const transform = { ...IDENTITY_TRANSFORM, x, y };
  return { ...createRectangle({ id, color: COLOR, spec, transform }), operationIds: [COLOR] };
}

function circle(id: string, x: number, y: number, diameter: number): SceneObject {
  const spec = { widthMm: diameter, heightMm: diameter };
  const transform = { ...IDENTITY_TRANSFORM, x, y };
  return { ...createEllipse({ id, color: COLOR, spec, transform }), operationIds: [COLOR] };
}

const PLATE = rectangle('plate', 0, 0, 50, 30);
const HOLE = rectangle('hole', 20, 10, 10, 10);
const DISC = circle('disc', 36, 11, 8);

function load(objects: ReadonlyArray<SceneObject>): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: { objects, layers: [createLayer({ id: COLOR, color: COLOR })], groups: [] },
    },
    selectedObjectId: objects[0]?.id ?? null,
    additionalSelectedIds: new Set(objects.slice(1).map((object) => object.id)),
    dirty: false,
  });
}

function request(patch: Partial<OffsetShapesRequest>): OffsetShapesRequest {
  return {
    distanceMm: 1,
    direction: 'outward',
    cornerStyle: 'corner',
    outerShapesOnly: false,
    deleteOriginals: true,
    ...patch,
  };
}

// Every cut contour of the compiled job as "width x height", to 0.01 mm, largest first.
function cutSizes(scene: Scene): string[] {
  return compileJob(scene, DEFAULT_DEVICE_PROFILE)
    .groups.flatMap((group) => (group.kind === 'cut' ? group.segments : []))
    .map((segment) => size(segment.polyline))
    .sort((a, b) => Number.parseFloat(b) - Number.parseFloat(a) || b.localeCompare(a));
}

function size(points: ReadonlyArray<Vec2>): string {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const extent = (values: number[]): string =>
    (Math.max(...values) - Math.min(...values)).toFixed(2);
  return `${extent(xs)}x${extent(ys)}`;
}

function sceneAfter(): Scene {
  return useStore.getState().project.scene;
}

describe('Offset Shapes with a hole drawn as its own object', () => {
  beforeEach(() => {
    resetStore();
    useToastStore.setState({ toasts: [] });
  });

  it('keeps the hole in the burn when Delete original objects removes the sources', () => {
    load([PLATE, HOLE, DISC]);
    expect(cutSizes(sceneAfter())).toEqual(['50.00x30.00', '10.00x10.00', '8.00x8.00']);

    expect(useStore.getState().offsetShapesSelection(request({}))).toBe(true);

    const ids = sceneAfter().objects.map((object) => object.id);
    expect(ids).toHaveLength(1);
    expect(ids).not.toContain('hole');
    const sizes = cutSizes(sceneAfter());
    expect(sizes.slice(0, 2)).toEqual(['52.00x32.00', '8.00x8.00']);
    // The disc's chords sit inside its circle, so its hole comes out a hair under 6 mm.
    expect(sizes).toHaveLength(3);
    expect(Number.parseFloat(sizes[2]!)).toBeCloseTo(6, 1);
  });

  it('grows the hole for Inward and keeps both sets for Both', () => {
    load([PLATE, HOLE]);
    useStore.getState().offsetShapesSelection(request({ direction: 'inward' }));
    expect(cutSizes(sceneAfter())).toEqual(['48.00x28.00', '12.00x12.00']);

    load([PLATE, HOLE]);
    useStore.getState().offsetShapesSelection(request({ direction: 'both' }));
    expect(cutSizes(sceneAfter())).toEqual([
      '52.00x32.00',
      '48.00x28.00',
      '12.00x12.00',
      '8.00x8.00',
    ]);
  });

  it('ignores the inner shape only when Outer shapes only is on', () => {
    load([PLATE, HOLE]);
    useStore
      .getState()
      .offsetShapesSelection(request({ direction: 'both', outerShapesOnly: true }));
    expect(cutSizes(sceneAfter())).toEqual(['52.00x32.00', '48.00x28.00']);
  });

  it('gives the same result whichever object is selected first', () => {
    load([HOLE, PLATE]);
    useStore.getState().offsetShapesSelection(request({}));
    expect(cutSizes(sceneAfter())).toEqual(['52.00x32.00', '8.00x8.00']);
  });

  it('still welds two overlapping shapes into one outline', () => {
    load([rectangle('a', 0, 0, 10, 10), rectangle('b', 5, 0, 10, 10)]);
    useStore.getState().offsetShapesSelection(request({}));
    expect(cutSizes(sceneAfter())).toEqual(['17.00x12.00']);
  });
});

describe('the Offset outlines row with a hole drawn as its own object', () => {
  beforeEach(() => {
    resetStore();
    useToastStore.setState({ toasts: [] });
  });

  it('adds an outline with the hole beside the sources it keeps', () => {
    load([PLATE, HOLE]);
    useStore.getState().offsetSelection(1);
    expect(cutSizes(sceneAfter())).toEqual([
      '52.00x32.00',
      '50.00x30.00',
      '10.00x10.00',
      '8.00x8.00',
    ]);
  });

  it('grows the hole for a negative distance', () => {
    load([PLATE, HOLE]);
    useStore.getState().offsetSelection(-1);
    expect(cutSizes(sceneAfter())).toEqual([
      '50.00x30.00',
      '48.00x28.00',
      '12.00x12.00',
      '10.00x10.00',
    ]);
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
