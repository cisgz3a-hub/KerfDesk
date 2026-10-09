import { describe, expect, it } from 'vitest';
import type { ReliefRailProfileSource } from '../scene/relief/relief-rail-profile';
import { createComponentSampler } from './relief-authoring-sampling';
import { reliefRailProfileError } from './relief-rail-profile-validation';
import { createBlankReliefAuthoringDocument } from './relief-authoring-document';
import { materializeReliefAuthoring } from './materialize-relief-authoring';
import { IDENTITY_TRANSFORM } from '../scene/scene-object';

const graph = (peak: number) => [
  { x: 0, y: 0 },
  { x: 0.5, y: peak },
  { x: 1, y: 0 },
];
const straight: ReliefRailProfileSource = {
  kind: 'rail-profile-v1',
  rail: {
    points: [
      { x: 0, y: 5 },
      { x: 10, y: 5 },
    ],
  },
  widthMm: 4,
  samplingSteps: 8,
  sections: [
    { id: 'a', position: 0, widthScale: 1, profile: graph(2) },
    { id: 'b', position: 0.5, widthScale: 0.5, profile: graph(6) },
    { id: 'c', position: 1, widthScale: 1.5, profile: graph(4) },
  ],
};
describe('physical ruled-strip profile coordinates', () => {
  it('preserves symmetric cross sections between sampling stations when width changes', () => {
    const sample = createComponentSampler(straight);
    for (const x of [0.5, 2.3, 5.7, 9.5]) {
      const fraction = x <= 5 ? x / 5 : (x - 5) / 5;
      const widthScale = x <= 5 ? 1 - 0.5 * fraction : 0.5 + fraction;
      const peak = x <= 5 ? 2 + 4 * fraction : 6 - 2 * fraction;
      for (const offset of [0, 0.25, -0.25]) {
        const actual = sample({ x, y: 5 + offset });
        expect(actual.included).toBe(true);
        expect(actual.heightMm).toBeCloseTo(peak * (1 - Math.abs(offset) / (2 * widthScale)), 10);
      }
    }
  });
  it('inverts independently generated points between nonparallel side rails', () => {
    const source: ReliefRailProfileSource = {
      ...straight,
      rail: {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
      secondRail: {
        points: [
          { x: 0, y: 4 },
          { x: 10, y: 7 },
        ],
      },
      sections: [
        { id: 'a', position: 0, widthScale: 1, profile: graph(2) },
        { id: 'b', position: 1, widthScale: 1, profile: graph(6) },
      ],
    };
    const sample = createComponentSampler(source);
    for (const t of [0.07, 0.17, 0.43, 0.79, 0.97])
      for (const u of [0.13, 0.37, 0.5, 0.63, 0.87]) {
        const actual = sample({ x: 10 * t, y: u * (4 + 3 * t) });
        expect(actual.included).toBe(true);
        expect(actual.heightMm).toBeCloseTo((2 + 4 * t) * (1 - Math.abs(2 * u - 1)), 10);
      }
  });
});

function twoRails(endX: number, endY: number): ReliefRailProfileSource {
  return {
    kind: 'rail-profile-v1',
    rail: {
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
      ],
    },
    secondRail: {
      points: [
        { x: 1, y: 0 },
        { x: endX, y: endY },
      ],
    },
    widthMm: 1,
    samplingSteps: 1,
    sections: [
      {
        id: 'start',
        position: 0,
        widthScale: 1,
        profile: [
          { x: 0, y: 1 },
          { x: 1, y: 1 },
        ],
      },
      {
        id: 'end',
        position: 1,
        widthScale: 1,
        profile: [
          { x: 0, y: 9 },
          { x: 1, y: 9 },
        ],
      },
    ],
  };
}
function reflected(
  source: ReliefRailProfileSource,
  sx: number,
  sy: number,
): ReliefRailProfileSource {
  const second = source.secondRail;
  if (second === undefined) throw new Error('Expected two rails.');
  const point = (p: { x: number; y: number }) => ({ x: sx * p.x, y: sy * p.y });
  return {
    ...source,
    rail: { ...source.rail, points: source.rail.points.map(point) },
    secondRail: { ...second, points: second.points.map(point) },
  };
}
const reflections = [
  { name: 'ordinary', sx: 1, sy: 1 },
  { name: 'mirror X', sx: -1, sy: 1 },
  { name: 'mirror Y', sx: 1, sy: -1 },
  { name: 'mirror both', sx: -1, sy: -1 },
];
describe('bilinear strip admission', () => {
  it.each(reflections)(
    'rejects a folded concave strip under $name despite matching diagonal triangle signs',
    ({ sx, sy }) => {
      const source = reflected(twoRails(0.2, 0.2), sx, sy);
      expect(reliefRailProfileError(source)).toMatch(/bilinear strip/u);
      expect(() => createComponentSampler(source)).toThrow(/bilinear strip/u);
    },
  );
  it.each(reflections)('retains an injective convex strip under $name', ({ sx, sy }) => {
    const source = reflected(twoRails(0.8, 1), sx, sy);
    expect(reliefRailProfileError(source)).toBeNull();
    const sample = createComponentSampler(source);
    for (const t of [0.1, 0.37, 0.93])
      for (const u of [0.13, 0.5, 0.87]) {
        // Forward ruled interpolation is independent of the inverse solver.
        const result = sample({ x: sx * (1 - 0.2 * t) * u, y: sy * t });
        expect(result.included).toBe(true);
        expect(result.heightMm).toBeCloseTo(1 + 8 * t, 10);
      }
  });
  it('rejects a Jacobian that becomes exactly zero at one corner', () => {
    expect(reliefRailProfileError(twoRails(0.5, 0.5))).toMatch(/bilinear strip/u);
  });
  it('returns the existing materialization error without changing retained source', () => {
    const source = twoRails(0.2, 0.2),
      before = JSON.stringify(source);
    const document = {
      ...createBlankReliefAuthoringDocument({
        width: 10,
        height: 10,
        physicalWidthMm: 1,
        physicalHeightMm: 1,
        maxDepthMm: 10,
      }),
      components: [
        {
          id: 'rail',
          name: 'Rail',
          levelId: 'level-1',
          visible: true,
          combineMode: 'replace' as const,
          transform: IDENTITY_TRANSFORM,
          baseHeightMm: 0,
          heightScale: 1,
          source,
        },
      ],
    };
    expect(materializeReliefAuthoring(document)).toMatchObject({
      kind: 'error',
      reason: expect.stringMatching(/bilinear strip/u),
    });
    expect(JSON.stringify(source)).toBe(before);
  });
});
