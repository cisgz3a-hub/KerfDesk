import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  type ArrayPlacement,
  type SceneGroup,
  type SceneObject,
  type TextObject,
} from '../../core/scene';
import { planArrayFirstPlacement } from './array-first-placement';
import { sceneObjectCopyClosure } from './scene-object-copy-dependencies';

const PLACEMENT = { dx: 95, dy: 97.5, rotationDeg: 0 } as const;

describe('planArrayFirstPlacement', () => {
  it.each([
    ['shared', false, true],
    ['locked', true, false],
  ])('copies a %s guide instead of moving its original owner', (_ownership, locked, shared) => {
    const guide = { ...object('guide'), locked };
    const root = text('root', guide.id);
    const outside = { ...text('outside', guide.id), transform: transformAt(20, 0) };
    const plan = firstPlacementPlan([guide, root, ...(shared ? [outside] : [])], root.id);

    expect(plan.protectedSourceIds).toEqual(new Set([guide.id]));
    expect(plan.movedById.has(guide.id)).toBe(false);
    const movedRoot = plan.movedById.get(root.id);
    expect(movedRoot?.transform).toMatchObject({ x: 95, y: 97.5 });
    expect(plan.copiedObjects[0]?.transform).toMatchObject({ x: 95, y: 97.5 });
    expect(movedRoot?.kind === 'text' ? movedRoot.pathText?.guideObjectId : guide.id).toBe(
      plan.copiedObjects[0]?.id,
    );
  });

  it.each([
    ['shared', false, true],
    ['locked', true, false],
  ])('protects every downstream dependency of a %s guide', (_ownership, locked, shared) => {
    const guide = object('guide');
    const middle = { ...text('middle', guide.id), locked };
    const root = text('root', middle.id);
    const outside = { ...text('outside', middle.id), transform: transformAt(30, 0) };
    const plan = firstPlacementPlan([guide, middle, root, ...(shared ? [outside] : [])], root.id);

    expect(plan.protectedSourceIds).toEqual(new Set([middle.id, guide.id]));
    const copiedMiddleId = plan.copiedIds.get(middle.id);
    const copiedGuideId = plan.copiedIds.get(guide.id);
    const movedRoot = plan.movedById.get(root.id);
    const copiedMiddle = plan.copiedObjects.find((item) => item.id === copiedMiddleId);
    expect(movedRoot?.kind === 'text' ? movedRoot.pathText?.guideObjectId : null).toBe(
      copiedMiddleId,
    );
    expect(copiedMiddle?.kind === 'text' ? copiedMiddle.pathText?.guideObjectId : null).toBe(
      copiedGuideId,
    );
    expect(plan.copiedObjects.every((item) => item.transform.x === 95)).toBe(true);
  });

  it('protects a dependency at the boundary of an untouched group', () => {
    const guide = object('guide');
    const root = text('root', guide.id);
    const unrelated = { ...object('unrelated'), transform: transformAt(30, 0) };
    const group = { id: 'group', name: 'Untouched', objectIds: [guide.id, unrelated.id] };

    const plan = firstPlacementPlan([guide, root, unrelated], root.id, [group]);

    expect(plan.protectedSourceIds).toEqual(new Set([guide.id]));
    expect(plan.movedById.has(guide.id)).toBe(false);
    expect(plan.movedById.has(unrelated.id)).toBe(false);
  });

  it('copies a selected source that is owned by unselected artwork', () => {
    const root = object('root');
    const outside = { ...text('outside', root.id), transform: transformAt(30, 0) };

    const plan = firstPlacementPlan([root, outside], root.id);

    expect(plan.protectedSourceIds).toEqual(new Set([root.id]));
    expect(plan.movedById.has(root.id)).toBe(false);
    expect(plan.selectedObjectIds).toEqual([plan.copiedIds.get(root.id)]);
    expect(plan.copiedObjects[0]?.transform).toMatchObject({ x: 95, y: 97.5 });
  });

  it.each([360, -360])(
    'keeps a shared dependency component unchanged for an equivalent %d-degree turn',
    (rotationDeg) => {
      const guide = object('guide');
      const root = text('root', guide.id);
      const outside = { ...text('outside', guide.id), transform: transformAt(30, 0) };

      const plan = firstPlacementPlan([guide, root, outside], root.id, [], {
        dx: 0,
        dy: 0,
        rotationDeg,
        pivot: { x: 5, y: 2.5 },
      });

      expect(plan.protectedSourceIds.size).toBe(0);
      expect(plan.copiedObjects).toEqual([]);
      expect(plan.movedById.get(guide.id)?.transform).toEqual(guide.transform);
      expect(plan.movedById.get(root.id)).toEqual(root);
    },
  );

  it('expands one large protected group as one component', () => {
    const objects = Array.from({ length: 1_000 }, (_, index) =>
      index === 999 ? object(`member-${index}`) : text(`member-${index}`, `member-${index + 1}`),
    );
    const outside = text('outside', objects[0]?.id ?? 'missing');
    const group = { id: 'large-group', name: 'Large', objectIds: objects.map((item) => item.id) };

    const plan = firstPlacementPlan([...objects, outside], objects[0]?.id ?? 'missing', [group]);

    expect(plan.protectedSourceIds.size).toBe(objects.length);
    expect(plan.copiedObjects).toHaveLength(objects.length);
  });

  it('closes protection through a shared cycle and selects the placed clone', () => {
    const root = text('root', 'middle');
    const middle = text('middle', root.id);
    const outside = { ...text('outside', middle.id), transform: transformAt(30, 0) };

    const plan = firstPlacementPlan([root, middle, outside], root.id);

    expect(plan.protectedSourceIds).toEqual(new Set([middle.id, root.id]));
    expect(plan.movedById.size).toBe(0);
    expect(plan.selectedObjectIds).toEqual([plan.copiedIds.get(root.id)]);
    const copiedRoot = plan.copiedObjects.find((item) => item.id === plan.copiedIds.get(root.id));
    const copiedMiddle = plan.copiedObjects.find(
      (item) => item.id === plan.copiedIds.get(middle.id),
    );
    expect(copiedRoot?.kind === 'text' ? copiedRoot.pathText?.guideObjectId : null).toBe(
      copiedMiddle?.id,
    );
    expect(copiedMiddle?.kind === 'text' ? copiedMiddle.pathText?.guideObjectId : null).toBe(
      copiedRoot?.id,
    );
  });
});

function firstPlacementPlan(
  objects: ReadonlyArray<SceneObject>,
  selectedId: string,
  groups: ReadonlyArray<SceneGroup> = [],
  placement: ArrayPlacement = PLACEMENT,
) {
  let nextId = 0;
  const selected = objects.filter((object) => object.id === selectedId);
  const copySources = sceneObjectCopyClosure(objects, new Set([selectedId]));
  return planArrayFirstPlacement(
    objects,
    groups,
    selected,
    copySources,
    placement,
    () => `copy-${nextId++}`,
  );
}

function object(id: string): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 10, heightMm: 5, cornerRadiusMm: 0 },
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    transform: IDENTITY_TRANSFORM,
    color: '#000000',
    paths: [],
  };
}

function text(id: string, guideObjectId: string): TextObject {
  return {
    kind: 'text',
    id,
    content: id,
    fontKey: 'Roboto',
    sizeMm: 5,
    alignment: 'left',
    lineHeight: 1,
    letterSpacing: 0,
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
    pathText: { guideObjectId, offsetMm: 0, reverse: false },
  };
}

function transformAt(x: number, y: number) {
  return { ...IDENTITY_TRANSFORM, x, y };
}
