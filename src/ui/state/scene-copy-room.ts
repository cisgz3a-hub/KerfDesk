import { retainedBooleanOperandCount } from '../../core/scene/boolean-compound';
// How many copies the project has room for, shared by the commands that copy
// the selection: Array (ADR-307 amendment 1) and Copy Along Path (ADR-498
// amendment 1). A project holds at most PROJECT_SCENE_LIMITS.objects objects and
// cannot be reopened above that (the loader refuses it), so that is the one limit
// on how many copies such a command can make. Every request that fits is placed;
// one that does not is explained and not applied, never clamped. The exact check
// on a built scene also holds every other command that adds objects in one step
// (Duplicate, Paste, Break Apart, ...) to the loader's limits.

import type { Scene } from '../../core/scene/scene';
import { PROJECT_SCENE_LIMITS } from '../../io/project/project-scene-integrity-validator';
import { sceneObjectCopyClosure } from './scene-object-copy-dependencies';
import { useToastStore } from './toast-store';

const OBJECT_LIMIT = `project limit ${PROJECT_SCENE_LIMITS.objects} objects`;

/**
 * How many more copies fit when the project will hold `objectsKept` objects
 * before the copies and each copy adds `objectsPerCopy`. Never negative: a
 * project already over its limit has room for none.
 */
export function copiesThatFit(objectsKept: number, objectsPerCopy: number): number {
  const free = PROJECT_SCENE_LIMITS.objects - objectsKept;
  return Math.max(0, Math.floor(free / Math.max(1, objectsPerCopy)));
}

/**
 * How many more copies of `sourceIds` the scene has room for. A copy is those
 * objects and whatever they need with them (an image's mask, a path text's
 * guide). `originalsFreed` is how many objects the command takes out of the
 * project as it copies, which give their places back.
 */
export function sceneCopyRoom(
  scene: Scene,
  sourceIds: ReadonlySet<string>,
  originalsFreed = 0,
): number {
  const closure = sceneObjectCopyClosure(scene.objects, sourceIds);
  const perCopy = closure.length + retainedBooleanOperandCount(closure);
  const retainedFreed =
    originalsFreed === sourceIds.size
      ? retainedBooleanOperandCount(scene.objects.filter((object) => sourceIds.has(object.id)))
      : 0;
  return copiesThatFit(
    scene.objects.length +
      retainedBooleanOperandCount(scene.objects) -
      originalsFreed -
      retainedFreed,
    perCopy,
  );
}

/**
 * "This project has room for at most 18 more copies of this artwork (project
 * limit 10000 objects)", for the caller to follow with what to change. Only for
 * a `room` of 1 or more; `noRoomMessage` says it when there is none.
 */
export function roomHolds(room: number, subject: string): string {
  const copies = room === 1 ? '1 more copy' : `${room} more copies`;
  return `This project has room for at most ${copies} of this ${subject} (${OBJECT_LIMIT})`;
}

export function noRoomMessage(subject: string): string {
  return `This project has no room for another copy of this ${subject} (${OBJECT_LIMIT}). Delete some objects first.`;
}

type Budget = {
  readonly what: string;
  readonly limit: number;
  readonly count: (scene: Scene) => number;
};

// The four counts the project loader holds a scene to (validateSceneBudgets).
// Copies add objects and, when they carry whole groups, groups and members; a
// paste from another project brings its operations (scene layers) with it.
const BUDGETS: ReadonlyArray<Budget> = [
  {
    what: 'objects',
    limit: PROJECT_SCENE_LIMITS.objects,
    count: (scene) => scene.objects.length + retainedBooleanOperandCount(scene.objects),
  },
  {
    what: 'groups',
    limit: PROJECT_SCENE_LIMITS.groups,
    count: (scene) => scene.groups?.length ?? 0,
  },
  {
    what: 'group members',
    limit: PROJECT_SCENE_LIMITS.groupMembers,
    count: (scene) => (scene.groups ?? []).reduce((sum, group) => sum + group.objectIds.length, 0),
  },
  { what: 'operations', limit: PROJECT_SCENE_LIMITS.layers, count: (scene) => scene.layers.length },
];

/**
 * Why `after` may not replace `before`, or null. Copying never takes a project
 * over a limit it can be reopened with: a count that is over its limit and grew
 * is refused. The room worked out beforehand counts objects only, so this is the
 * exact check on the scene a command has built. A project that is already over
 * stays free to change in ways that add nothing. `ask` says what to change, in
 * the words of the command that was refused.
 */
export function sceneLimitOverrun(
  before: Scene,
  after: Scene,
  ask = 'Ask for fewer copies, or delete some objects first.',
): string | null {
  for (const budget of BUDGETS) {
    const now = budget.count(after);
    if (now > budget.limit && now > budget.count(before)) {
      return `This would take the project past its limit of ${budget.limit} ${budget.what}. ${ask}`;
    }
  }
  return null;
}

/**
 * The same check for a command that adds objects in one step: true, after a
 * notice saying why and what to change, when `after` may not replace `before`.
 * The command then leaves the project as it was; one that fits goes ahead
 * unchanged. It refuses nothing but a limit overrun.
 */
export function refuseSceneLimitOverrun(before: Scene, after: Scene, ask: string): boolean {
  const overrun = sceneLimitOverrun(before, after, ask);
  if (overrun === null) return false;
  useToastStore.getState().pushToast(overrun, 'warning');
  return true;
}
