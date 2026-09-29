// The room a project has for copies, shared by Array and Copy Along Path
// (ADR-307 amendment 1, ADR-498 amendment 1).

import { describe, expect, it } from 'vitest';
import { createLayer } from '../../core/scene/layer';
import type { Scene, SceneGroup } from '../../core/scene/scene';
import { IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene/scene-object';
import {
  PROJECT_SCENE_LIMITS,
  validateSceneBudgets,
} from '../../io/project/project-scene-integrity-validator';
import {
  copiesThatFit,
  noRoomMessage,
  roomHolds,
  sceneCopyRoom,
  sceneLimitOverrun,
} from './scene-copy-room';

const LIMIT = PROJECT_SCENE_LIMITS.objects;

function rect(id: string): SceneObject {
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

const MASKED_IMAGE: SceneObject = {
  kind: 'raster-image',
  id: 'image',
  source: 'image.png',
  dataUrl: 'data:image/png;base64,AA==',
  pixelWidth: 1,
  pixelHeight: 1,
  bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 },
  transform: IDENTITY_TRANSFORM,
  color: '#000000',
  dither: 'grayscale',
  linesPerMm: 1,
  lumaBase64: 'AA==',
  imageMaskId: 'mask',
};

function scene(objects: ReadonlyArray<SceneObject>, groups: ReadonlyArray<SceneGroup> = []): Scene {
  return { objects, layers: [createLayer({ id: '#000000', color: '#000000' })], groups };
}

function objects(count: number, prefix = 'o'): ReadonlyArray<SceneObject> {
  return Array.from({ length: count }, (_, index) => rect(`${prefix}-${index}`));
}

// A scene of four objects on `count` operations.
function operations(count: number): Scene {
  const layers = Array.from({ length: count }, (_, index) => {
    const color = `#${index.toString(16).padStart(6, '0')}`;
    return createLayer({ id: `operation-${index}`, color });
  });
  return { ...scene(objects(4)), layers };
}

function groupsOf(count: number, members: number): ReadonlyArray<SceneGroup> {
  return Array.from({ length: count }, (_, index) => ({
    id: `g-${index}`,
    name: `G${index}`,
    objectIds: Array.from({ length: members }, (_, member) => `o-${member}`),
  }));
}

describe('copiesThatFit', () => {
  it.each([
    [0, 1, LIMIT],
    [9_982, 1, 18],
    [9_990, 2, 5],
    [9_991, 2, 4],
    [LIMIT, 1, 0],
    [LIMIT + 40, 3, 0],
    [0, 0, LIMIT],
  ])('a project of %s objects and %s per copy has room for %s', (kept, perCopy, room) => {
    // A copy is at least one object, and a project over its limit has no room.
    expect(copiesThatFit(kept, perCopy)).toBe(room);
  });
});

describe('sceneCopyRoom', () => {
  it('counts what a copy carries with it, not only what was selected', () => {
    const full = scene([MASKED_IMAGE, rect('mask'), ...objects(LIMIT - 12)]);

    expect(sceneCopyRoom(full, new Set(['image']))).toBe(5);
    expect(sceneCopyRoom(full, new Set(['mask']))).toBe(10);
  });

  it('gives back the places of originals the command takes out of the project', () => {
    const full = scene(objects(LIMIT - 3));

    expect(sceneCopyRoom(full, new Set(['o-0', 'o-1']))).toBe(1);
    expect(sceneCopyRoom(full, new Set(['o-0', 'o-1']), 2)).toBe(2);
  });

  it('is zero for a project already over its limit, and never negative', () => {
    expect(sceneCopyRoom(scene(objects(LIMIT + 7)), new Set(['o-0']))).toBe(0);
  });

  it('treats an empty selection as one object per copy', () => {
    expect(sceneCopyRoom(scene(objects(10)), new Set())).toBe(LIMIT - 10);
  });
});

describe('the messages', () => {
  it('say how many copies fit and the limit they come from', () => {
    expect(roomHolds(18, 'artwork')).toBe(
      'This project has room for at most 18 more copies of this artwork (project limit 10000 objects)',
    );
    expect(roomHolds(1, 'selection')).toBe(
      'This project has room for at most 1 more copy of this selection (project limit 10000 objects)',
    );
  });

  it('say so when there is no room at all', () => {
    expect(noRoomMessage('selection')).toBe(
      'This project has no room for another copy of this selection (project limit 10000 objects). Delete some objects first.',
    );
  });
});

describe('sceneLimitOverrun', () => {
  it('accepts a scene at its limits and names nothing', () => {
    const before = scene(objects(LIMIT - 5));

    expect(sceneLimitOverrun(before, scene(objects(LIMIT)))).toBeNull();
  });

  it.each([
    ['objects', scene(objects(LIMIT + 1)), LIMIT],
    [
      'groups',
      scene(objects(4), groupsOf(PROJECT_SCENE_LIMITS.groups + 1, 2)),
      PROJECT_SCENE_LIMITS.groups,
    ],
    [
      'group members',
      scene(objects(10), groupsOf(PROJECT_SCENE_LIMITS.groupMembers / 10 + 1, 10)),
      PROJECT_SCENE_LIMITS.groupMembers,
    ],
    ['operations', operations(PROJECT_SCENE_LIMITS.layers + 1), PROJECT_SCENE_LIMITS.layers],
  ])('refuses a scene whose %s grew past their limit', (what, after, limit) => {
    expect(sceneLimitOverrun(scene(objects(4)), after)).toBe(
      `This would take the project past its limit of ${limit} ${what}. Ask for fewer copies, or delete some objects first.`,
    );
  });

  it("says what to change in the refused command's own words", () => {
    expect(
      sceneLimitOverrun(scene(objects(4)), scene(objects(LIMIT + 1)), 'Duplicate fewer objects.'),
    ).toBe(
      `This would take the project past its limit of ${LIMIT} objects. Duplicate fewer objects.`,
    );
  });

  it('agrees with the loader about which scenes it would refuse', () => {
    const cases = [
      scene(objects(LIMIT)),
      scene(objects(LIMIT + 1)),
      scene(objects(4), groupsOf(PROJECT_SCENE_LIMITS.groups, 2)),
      scene(objects(4), groupsOf(PROJECT_SCENE_LIMITS.groups + 1, 2)),
      scene(objects(10), groupsOf(PROJECT_SCENE_LIMITS.groupMembers / 10, 10)),
      scene(objects(10), groupsOf(PROJECT_SCENE_LIMITS.groupMembers / 10 + 1, 10)),
      operations(PROJECT_SCENE_LIMITS.layers),
      operations(PROJECT_SCENE_LIMITS.layers + 1),
    ];
    const empty = scene([]);

    for (const candidate of cases) {
      expect(sceneLimitOverrun(empty, candidate) === null).toBe(
        validateSceneBudgets(candidate) === null,
      );
    }
  });

  it('leaves a project that is already over a limit free to change without growing', () => {
    const over = scene(objects(LIMIT + 4));

    expect(sceneLimitOverrun(over, scene(objects(LIMIT + 4)))).toBeNull();
    expect(sceneLimitOverrun(over, scene(objects(LIMIT + 2)))).toBeNull();
    expect(sceneLimitOverrun(over, scene(objects(LIMIT + 5)))).not.toBeNull();
  });

  it('holds each count to its own limit when another was already over', () => {
    const before = scene(objects(4), groupsOf(PROJECT_SCENE_LIMITS.groups + 3, 2));

    // Groups were over and did not grow; the objects grew but are within theirs.
    expect(sceneLimitOverrun(before, scene(objects(9), before.groups))).toBeNull();
  });
});
