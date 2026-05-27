import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, EMPTY_SCENE, IDENTITY_TRANSFORM, type SceneObject } from '../scene';
import { compileJob } from './compile-job';

function svgObj(args: {
  id: string;
  color: string;
  points: ReadonlyArray<{ x: number; y: number }>;
}): SceneObject {
  return {
    kind: 'imported-svg',
    id: args.id,
    source: `${args.id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: args.color, polylines: [{ points: args.points, closed: false }] }],
  };
}

const dev = DEFAULT_DEVICE_PROFILE;

describe('compileJob', () => {
  it('returns an empty job for an empty scene', () => {
    expect(compileJob(EMPTY_SCENE, dev).groups).toEqual([]);
  });

  it('skips layers with output=false', () => {
    const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), output: false };
    const obj = svgObj({
      id: 'O1',
      color: '#ff0000',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    });
    const scene = { objects: [obj], layers: [layer] };
    expect(compileJob(scene, dev).groups).toEqual([]);
  });

  it('emits one CutGroup per matching layer in scene.layers order', () => {
    const layers = [
      createLayer({ id: 'L1', color: '#ff0000' }),
      createLayer({ id: 'L2', color: '#0000ff' }),
    ];
    const objects: SceneObject[] = [
      svgObj({
        id: 'O1',
        color: '#ff0000',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      }),
      svgObj({
        id: 'O2',
        color: '#0000ff',
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 10 },
        ],
      }),
    ];
    const job = compileJob({ objects, layers }, dev);
    expect(job.groups.map((g) => g.layerId)).toEqual(['L1', 'L2']);
  });

  it('caps speed at device.maxFeed (WORKFLOW.md F-A7 defense-in-depth)', () => {
    const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), speed: 99999 };
    const obj = svgObj({
      id: 'O1',
      color: '#ff0000',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
    });
    const job = compileJob({ objects: [obj], layers: [layer] }, dev);
    expect(job.groups[0]?.speed).toBe(dev.maxFeed);
  });

  it('clamps power to [0,100] and passes to ≥1', () => {
    const layer = {
      ...createLayer({ id: 'L1', color: '#ff0000' }),
      power: 999,
      passes: 0,
    };
    const obj = svgObj({
      id: 'O1',
      color: '#ff0000',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
    });
    const job = compileJob({ objects: [obj], layers: [layer] }, dev);
    expect(job.groups[0]?.power).toBe(100);
    expect(job.groups[0]?.passes).toBe(1);
  });

  it('omits a layer whose color has no matching geometry', () => {
    const layer = createLayer({ id: 'L1', color: '#00ff00' });
    const obj = svgObj({
      id: 'O1',
      color: '#ff0000', // mismatched
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    });
    expect(compileJob({ objects: [obj], layers: [layer] }, dev).groups).toEqual([]);
  });

  it('applies the object transform to each point, then Y-flips for front-left', () => {
    const layer = createLayer({ id: 'L1', color: '#ff0000' });
    const obj: SceneObject = {
      ...svgObj({
        id: 'O1',
        color: '#ff0000',
        points: [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
      }),
      transform: { ...IDENTITY_TRANSFORM, x: 100, y: 100 },
    };
    const job = compileJob({ objects: [obj], layers: [layer] }, dev);
    // Object transform: (1,1) → (101,101), (2,2) → (102,102).
    // Default device is front-left origin (bedH = 400); Y is flipped to
    // bedH - y → (101, 299), (102, 298).
    expect(job.groups[0]?.segments[0]?.polyline).toEqual([
      { x: 101, y: 299 },
      { x: 102, y: 298 },
    ]);
  });

  it('applies the device origin transform on top of the object transform', () => {
    const layer = createLayer({ id: 'L1', color: '#ff0000' });
    const obj = svgObj({
      id: 'O1',
      color: '#ff0000',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    });
    const job = compileJob({ objects: [obj], layers: [layer] }, { ...dev, origin: 'front-right' });
    // Front-right origin → X mirrored within bed (400), Y flipped (SVG top
    // y=0 → machine back y=bedHeight).
    expect(job.groups[0]?.segments[0]?.polyline).toEqual([
      { x: 400, y: 400 },
      { x: 390, y: 400 },
    ]);
  });
});
