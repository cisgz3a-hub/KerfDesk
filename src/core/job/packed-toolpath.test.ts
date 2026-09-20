import { describe, expect, it } from 'vitest';
import { canPackToolpathStep, packToolpath } from './packed-toolpath';
import { PackedToolpathSteps, packedToolpathSteps } from './packed-toolpath-steps';
import type { ToolpathStep } from './toolpath-types';

// One of every field the layout has a column for, including the values that
// have caught encoders before: a negative zero coordinate, a zero-length step,
// an absent motion (legacy rapid) and a raster source with only one label.
const steps: ToolpathStep[] = [
  { kind: 'travel', from: { x: -0, y: 2.25 }, to: { x: 7, y: 9 }, length: 10 },
  {
    kind: 'travel',
    from: { x: 1, y: 1 },
    to: { x: 1, y: 1 },
    length: 0,
    motion: 'feed',
    z: { from: -1.5, to: 0.25 },
  },
  { kind: 'travel', from: { x: 3, y: 4 }, to: { x: 5, y: 6 }, length: 2.8284, motion: 'rapid' },
  {
    kind: 'cut',
    color: '#123456',
    polyline: [
      { x: 0, y: 0 },
      { x: 12.5, y: -3.125 },
    ],
    length: 12.88,
  },
  {
    kind: 'cut',
    color: '#123456',
    polyline: [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 1 },
    ],
    length: 2.83,
    z: { from: 0, to: -2 },
    groupId: 'group-a',
    passIndex: 3,
  },
  {
    kind: 'cut',
    color: '#808080',
    polyline: [
      { x: 4, y: 4 },
      { x: 9, y: 4 },
    ],
    length: 5,
    source: {
      kind: 'raster',
      objectId: 'image-1',
      source: 'pixels.png',
      passIndex: 1,
      rowIndex: 42,
      spanIndex: 2,
      pixelStartX: 11,
      pixelEndX: 19,
    },
  },
  {
    kind: 'cut',
    color: '#808080',
    polyline: [
      { x: 4, y: 5 },
      { x: 9, y: 5 },
    ],
    length: 5,
    source: {
      kind: 'raster',
      passIndex: 0,
      rowIndex: 1,
      spanIndex: 0,
      pixelStartX: 0,
      pixelEndX: 3,
    },
  },
  { kind: 'plunge', at: { x: 8, y: 8 }, fromZ: 2, toZ: -1.5, length: 3.5 },
];

describe('packed toolpath', () => {
  it('reads back every packed step exactly', () => {
    const list = packedToolpathSteps(steps);
    expect(list).toBeInstanceOf(PackedToolpathSteps);
    expect(list.length).toBe(steps.length);
    expect([...list]).toStrictEqual(steps);
    for (const [index, step] of steps.entries()) {
      expect(list.at(index)).toStrictEqual(step);
    }
    // -0 must survive: a preview point mapped through a mirrored origin can
    // legitimately land on it, and Object.is separates it from 0.
    const first = list.at(0);
    if (first?.kind !== 'travel') throw new Error('expected a travel step');
    expect(Object.is(first.from.x, -0)).toBe(true);
  });

  it('answers out-of-range and negative indices like an array', () => {
    const list = packedToolpathSteps(steps);
    expect(list.at(-1)).toStrictEqual(steps[steps.length - 1]);
    expect(list.at(steps.length)).toBeUndefined();
    expect(list.at(-steps.length - 1)).toBeUndefined();
    expect(list.at(0.5)).toBeUndefined();
  });

  it('matches the array for every method a route is read with', () => {
    const list = packedToolpathSteps(steps);
    const kinds = (step: ToolpathStep): string => step.kind;
    expect(list.map(kinds)).toStrictEqual(steps.map(kinds));
    expect(list.flatMap((step) => [step.kind])).toStrictEqual(steps.flatMap((s) => [s.kind]));
    expect(list.filter((step) => step.kind === 'cut')).toStrictEqual(
      steps.filter((step) => step.kind === 'cut'),
    );
    expect(list.find((step) => step.kind === 'plunge')).toStrictEqual(
      steps.find((step) => step.kind === 'plunge'),
    );
    expect(list.findIndex((step) => step.kind === 'plunge')).toBe(
      steps.findIndex((step) => step.kind === 'plunge'),
    );
    expect(list.some((step) => step.kind === 'plunge')).toBe(true);
    expect(list.some((step) => step.length === 999)).toBe(false);
    expect(list.every((step) => step.length >= 0)).toBe(true);
    expect(list.every((step) => step.kind === 'cut')).toBe(false);
    expect(list.reduce((sum, step) => sum + step.length, 0)).toBeCloseTo(
      steps.reduce((sum, step) => sum + step.length, 0),
      9,
    );
    expect(list.slice(2, 5)).toStrictEqual(steps.slice(2, 5));
    expect(list.slice(-2)).toStrictEqual(steps.slice(-2));
    expect(list.slice()).toStrictEqual(steps.slice());
    expect([...list.entries()]).toStrictEqual([...steps.entries()]);
  });

  it('hands back a fresh record per read, never a shared one', () => {
    const list = packedToolpathSteps(steps);
    expect(list.at(3)).not.toBe(list.at(3));
    expect(list.at(3)).toStrictEqual(list.at(3));
  });

  it('refuses a route whose steps have no column, rather than dropping fields', () => {
    const perVertexZ: ToolpathStep = {
      kind: 'cut',
      color: '#000000',
      polyline: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      length: 1,
      zs: [0, -1],
    };
    const tooled: ToolpathStep = {
      kind: 'plunge',
      at: { x: 0, y: 0 },
      fromZ: 0,
      toZ: -1,
      length: 1,
      toolId: 'bit',
    };
    for (const step of [perVertexZ, tooled]) {
      expect(canPackToolpathStep(step)).toBe(false);
      expect(packToolpath([step])).toBeNull();
      // The fallback is the caller's own array, unchanged.
      const source = [step];
      expect(packedToolpathSteps(source)).toBe(source);
    }
  });

  it('packs an empty route', () => {
    const list = packedToolpathSteps([]);
    expect(list.length).toBe(0);
    expect([...list]).toStrictEqual([]);
    expect(list.at(0)).toBeUndefined();
  });
});
