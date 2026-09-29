// Copy Along Path and the groups it copies (ADR-498 amendment 1, shared with
// ADR-307 amendment 1). The room for copies counts objects; a saved file can
// nest groups so that the copies' groups or group members pass their limits
// first, and a project past any of them cannot be reopened. Those are refused
// too, from the scene the copies make.

import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer } from '../../core/scene/layer';
import { createProject, type Project } from '../../core/scene/project';
import type { SceneGroup } from '../../core/scene/scene';
import {
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type SceneObject,
} from '../../core/scene/scene-object';
import {
  PROJECT_SCENE_LIMITS,
  validateSceneBudgets,
} from '../../io/project/project-scene-integrity-validator';
import type { CopyAlongPathRequest } from './copy-along-path-plan';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const REQUEST: CopyAlongPathRequest = {
  mode: 'count',
  count: 3,
  spacingMm: 10,
  startOffsetMm: 0,
  endOffsetMm: 0,
  rotateCopies: true,
  keepOriginal: true,
  guideId: 'guide',
};

function path(
  id: string,
  x: number,
  points: ReadonlyArray<readonly [number, number]>,
): ImportedSvg {
  const placed = points.map(([px, py]) => ({ x: px + x, y: py }));
  const xs = placed.map((point) => point.x);
  const ys = placed.map((point) => point.y);
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines: [{ closed: false, points: placed }] }],
  };
}

// 13 parts in a chain of 12 nested groups of 2, 3, ... 13 members, as a saved
// file can hold them: each copy adds 13 objects, 12 groups and 90 members.
const PARTS: ReadonlyArray<SceneObject> = Array.from({ length: 13 }, (_, index) =>
  path(`part-${index}`, index * 12, [
    [0, 0],
    [10, 4],
  ]),
);
const GUIDE = path('guide', 0, [
  [0, 50],
  [100, 50],
]);
const NESTED: ReadonlyArray<SceneGroup> = Array.from({ length: 12 }, (_, index) => ({
  id: `nest-${index}`,
  name: `Nest ${index}`,
  objectIds: PARTS.slice(0, index + 2).map((part) => part.id),
}));

// An image masked by the first part, left out of the selection: replacing the
// parts lets go of its mask, with a notice.
const MASKED_IMAGE: SceneObject = {
  kind: 'raster-image',
  id: 'image',
  source: 'image.png',
  dataUrl: 'data:image/png;base64,AA==',
  pixelWidth: 1,
  pixelHeight: 1,
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 4 },
  transform: IDENTITY_TRANSFORM,
  color: '#000000',
  dither: 'grayscale',
  linesPerMm: 1,
  lumaBase64: 'AA==',
  imageMaskId: 'part-0',
};
const MASK_LET_GO =
  '1 image mask reference was removed because its mask artwork was deleted. The image remains editable and unmasked.';

function load(extra: ReadonlyArray<SceneObject> = []): Project {
  const layers = [createLayer({ id: 'cut', name: 'cut', color: '#000000' })];
  const project = {
    ...createProject(),
    scene: { objects: [...PARTS, GUIDE, ...extra], layers, groups: NESTED },
  };
  useStore.setState({
    project,
    selectedObjectId: 'part-0',
    additionalSelectedIds: new Set([...PARTS.slice(1).map((part) => part.id), 'guide']),
    undoStack: [],
    dirty: false,
  });
  return project;
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('Copy Along Path and group limits', () => {
  it('refuses copies whose group members would pass the limit though their objects fit', () => {
    // 700 copies are 9,100 objects, but 700 x 90 group members is over 50,000.
    const before = load();

    expect(useStore.getState().copyAlongPath({ ...REQUEST, count: 700 })).toBe(false);

    expect(useStore.getState().project).toBe(before);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      message: `This would take the project past its limit of ${PROJECT_SCENE_LIMITS.groupMembers} group members. Ask for fewer copies, or delete some objects first.`,
      variant: 'warning',
    });
    expect(useStore.getState().undoStack).toEqual([]);
  });

  it('says nothing about a mask it did not let go when it is refused', () => {
    const before = load([MASKED_IMAGE]);

    expect(useStore.getState().copyAlongPath({ ...REQUEST, count: 700, keepOriginal: false })).toBe(
      false,
    );

    expect(useStore.getState().project).toBe(before);
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      `This would take the project past its limit of ${PROJECT_SCENE_LIMITS.groupMembers} group members. Ask for fewer copies, or delete some objects first.`,
    ]);
  });

  it('lets go of the mask, and says so, when the copies replace the parts', () => {
    load([MASKED_IMAGE]);

    expect(useStore.getState().copyAlongPath({ ...REQUEST, count: 500, keepOriginal: false })).toBe(
      true,
    );

    const image = useStore.getState().project.scene.objects.find((object) => object.id === 'image');
    expect(image).toBeDefined();
    expect(image).not.toHaveProperty('imageMaskId');
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      MASK_LET_GO,
      'Placed 500 copies along the guide path in place of the original.',
    ]);
  });

  it('places the copies that fit when their groups stay inside the limits', () => {
    load();

    expect(useStore.getState().copyAlongPath({ ...REQUEST, count: 500 })).toBe(true);

    const { scene } = useStore.getState().project;
    expect(scene.objects).toHaveLength(14 + 13 * 500);
    expect(scene.groups).toHaveLength(12 + 12 * 500);
    expect(validateSceneBudgets(scene)).toBeNull();
  });
});
