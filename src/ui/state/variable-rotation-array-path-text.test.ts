import { describe, expect, it, vi } from 'vitest';
import {
  applyTransform,
  IDENTITY_TRANSFORM,
  type ArraySpec,
  type SceneObject,
} from '../../core/scene';
import { materializeVariableText } from '../../io/gcode/prepare-output-snapshot';
import { renderVariableText } from '../text/render-variable-text';
import { applyArraySelection } from './array-actions';
import { prepareVariableArray } from './prepare-variable-array';
import { fixtureState, NOW } from './variable-array-test-fixture';

vi.mock('../text/render-text-geometry', () => ({
  renderTextGeometry: async ({ content, color }: { content: string; color: string }) => ({
    bounds: { minX: 0, minY: 0, maxX: content.length, maxY: 2 },
    paths: [
      {
        color,
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 2 },
              { x: content.length / 2, y: 0 },
              { x: content.length, y: 2 },
            ],
          },
        ],
      },
    ],
  }),
}));

const MODES: readonly ArraySpec[] = [
  {
    kind: 'circular',
    count: 4,
    centerX: 120,
    centerY: 100,
    radius: 50,
    startAngleDeg: 0,
    rotateCopies: true,
  },
  { kind: 'point-rotation', count: 4, totalAngleDeg: -180 },
];

function pathState(reverse: boolean) {
  const before = fixtureState();
  const name = before.project.scene.objects[0]!;
  if (name.kind !== 'text') throw new Error('Missing text');
  const guide: SceneObject = {
    kind: 'imported-svg',
    id: 'guide',
    source: 'guide.svg',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
    transform: { ...IDENTITY_TRANSFORM, x: 30, y: 40, rotationDeg: 17 },
    paths: [
      {
        color: name.color,
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
            ],
          },
        ],
      },
    ],
  };
  return {
    ...before,
    additionalSelectedIds: new Set(['guide']),
    project: {
      ...before.project,
      scene: {
        ...before.project.scene,
        objects: [{ ...name, pathText: { guideObjectId: 'guide', offsetMm: 3, reverse } }, guide],
        groups: [{ id: 'label', name: 'Label and guide', objectIds: [name.id, guide.id] }],
      },
    },
  };
}

function worldPoints(object: SceneObject) {
  if (!('paths' in object)) return [];
  return object.paths.flatMap((path) =>
    path.polylines.flatMap((line) =>
      line.points.map((point) => applyTransform(point, object.transform)),
    ),
  );
}

describe.each(MODES)('$kind variable text on copied guides', (spec) => {
  it.each([false, true])(
    'keeps rematerialized output on its copied guide (reverse %s)',
    async (reverse) => {
      const before = pathState(reverse);
      const prepared = await prepareVariableArray(before, spec, {
        render: renderVariableText,
        clock: () => NOW,
      });
      if (!prepared.ok) throw new Error(prepared.message);
      let id = 0;
      const result = {
        ...before,
        ...applyArraySelection(before, spec, () => `copy-${id++}`, prepared.materialized),
      };
      const rendered = await materializeVariableText(
        result.project,
        { now: NOW },
        renderVariableText,
      );
      if (!rendered.ok) throw new Error(JSON.stringify(rendered.preflight));
      expect(result.project.scene.groups).toHaveLength(4);
      for (const text of result.project.scene.objects) {
        if (text.kind !== 'text') continue;
        expect(
          result.project.scene.objects.some((object) => object.id === text.pathText?.guideObjectId),
        ).toBe(true);
        const emitted = rendered.project.scene.objects.find((object) => object.id === text.id)!;
        const expected = worldPoints(text);
        const actual = worldPoints(emitted);
        expect(actual).toHaveLength(expected.length);
        for (let index = 0; index < expected.length; index += 1) {
          expect(actual[index]!.x).toBeCloseTo(expected[index]!.x, 7);
          expect(actual[index]!.y).toBeCloseTo(expected[index]!.y, 7);
        }
      }
    },
  );
});
