import {
  isRegistrationBox,
  sceneObjectUsesOperation,
  type Layer,
  type Project,
  type Scene,
} from '../../../core/scene';
import {
  validateSceneBudgets,
  validateSceneIntegrity,
} from '../../../io/project/project-scene-integrity-validator';

// Rebase a jig draft onto a main project that changed while the editor was
// open. The editor is a full-screen modal, so those changes come from
// automation: variable advancement after a job, the completed outline run's
// switch to Artwork only, or another automatic update. A three-way merge
// against the project the editor opened keeps both sides: main-project changes
// to anything the draft left alone are carried over, and the draft's edits win
// for what it changed. Only overlapping changes are refused.
//
// Output flags never conflict. When the main project's output mode changed,
// the caller re-applies it to the rebased draft.

export type JigRebaseConflict =
  /** The main project's outlines changed; the draft owns the whole layout. */
  | 'outlines'
  /** Artwork, groups or ordering the draft changed were changed in main too. */
  | 'artwork'
  /** An operation setting was changed differently on both sides, or artwork
   *  in the merge uses an operation the other side removed. */
  | 'operations'
  /** A project field outside the scene was changed differently on both sides. */
  | 'project'
  /** Separately valid edits exceed a persistence budget when combined. */
  | 'scene-limits'
  /** The combined scene has conflicting identities, colours or references. */
  | 'scene-integrity';

export type JigRebase =
  | { readonly kind: 'rebased'; readonly project: Project }
  | { readonly kind: 'conflict'; readonly conflict: JigRebaseConflict };

// The editor owns these outright: the scene is merged below, the artwork
// output snapshot always comes from the draft.
const DRAFT_PROJECT_FIELDS = ['scene', 'registrationArtworkOutputSnapshot'];
const MERGED_SCENE_FIELDS = [
  'objects',
  'layers',
  'groups',
  'outputDependencies',
  'artworkOrder',
  'designTreeOrder',
];

class Conflict {
  constructor(readonly conflict: JigRebaseConflict) {}
}

function refuse(conflict: JigRebaseConflict): never {
  throw new Conflict(conflict);
}

export function rebaseJigDraft(base: Project, current: Project, draft: Project): JigRebase {
  try {
    const project = mergeFields(base, current, draft, 'project', DRAFT_PROJECT_FIELDS);
    project.scene = rebaseScene(base.scene, current.scene, draft.scene);
    const conflict = jigSceneConflict(project.scene as Scene);
    if (conflict !== null) refuse(conflict);
    if (draft.registrationArtworkOutputSnapshot !== undefined)
      project.registrationArtworkOutputSnapshot = draft.registrationArtworkOutputSnapshot;
    return { kind: 'rebased', project: project as Project };
  } catch (reason) {
    if (reason instanceof Conflict) return { kind: 'conflict', conflict: reason.conflict };
    throw reason;
  }
}

/** A saved jig must satisfy the same scene contract as a reopened project. */
export function jigSceneConflict(scene: Scene): JigRebaseConflict | null {
  if (validateSceneBudgets({ ...scene }) !== null) return 'scene-limits';
  return validateSceneIntegrity({ ...scene }) === null ? null : 'scene-integrity';
}

function rebaseScene(base: Scene, current: Scene, draft: Scene): Scene {
  // The outlines may already be burned, and the draft holds the whole layout,
  // so any change to them behind the editor is a conflict.
  if (outlinesChanged(base, current)) refuse('outlines');
  const objects = mergeEntries(base.objects, current.objects, draft.objects, artworkRules());
  const layers = mergeEntries(base.layers, current.layers, draft.layers, OPERATIONS);
  // An operation that left the merge must not be needed by artwork that stayed.
  for (const layer of base.layers) {
    if (layers.some((kept) => kept.id === layer.id)) continue;
    if (objects.some((object) => sceneObjectUsesOperation(object, layer))) refuse('operations');
  }
  const scene: Record<string, unknown> = {
    ...mergeFields(base, current, draft, 'artwork', MERGED_SCENE_FIELDS),
    objects,
    layers,
  };
  const lists = {
    groups: mergeOptional(base.groups, current.groups, draft.groups, (b, c, d) =>
      mergeEntries(b, c, d, artworkRules()),
    ),
    outputDependencies: mergeOptional(
      base.outputDependencies,
      current.outputDependencies,
      draft.outputDependencies,
      (b, c, d) => mergeEntries(b, c, d, artworkRules()),
    ),
    artworkOrder: mergeOptional(
      base.artworkOrder,
      current.artworkOrder,
      draft.artworkOrder,
      (b, c, d) => mergeOrder(b, c, d, (id) => id),
    ),
    designTreeOrder: mergeOptional(
      base.designTreeOrder,
      current.designTreeOrder,
      draft.designTreeOrder,
      (b, c, d) => mergeOrder(b, c, d, (entry) => `${entry.kind}:${entry.id}`),
    ),
  };
  for (const [key, value] of Object.entries(lists)) if (value !== undefined) scene[key] = value;
  return scene as Scene;
}

function outlinesChanged(base: Scene, current: Scene): boolean {
  const before = new Map(base.objects.filter(isRegistrationBox).map((box) => [box.id, box]));
  const after = current.objects.filter(isRegistrationBox);
  return (
    after.length !== before.size ||
    after.some((box) => {
      const original = before.get(box.id);
      return original === undefined || !same(original, box);
    })
  );
}

type EntryRules<T> = {
  readonly conflict: JigRebaseConflict;
  /** True when `next` differs from `original` in a way that can conflict. */
  readonly changed: (original: T, next: T) => boolean;
  /** Both sides changed the same entry: return the merged entry or refuse. */
  readonly both: (original: T, latest: T, edited: T) => T;
  /** One side removed an entry the other side changed. */
  readonly removed: () => void;
};

function artworkRules<T>(): EntryRules<T> {
  return {
    conflict: 'artwork',
    changed: (original, next) => !same(original, next),
    both: () => refuse('artwork'),
    removed: () => refuse('artwork'),
  };
}

// Operations merge setting by setting. Output follows the output mode, which
// the caller re-applies, so an output flag alone never makes a conflict. An
// operation removed on one side is dropped; rebaseScene then refuses if
// artwork still in the merge uses it.
const OPERATIONS: EntryRules<Layer> = {
  conflict: 'operations',
  changed: (original, next) => !same(withoutOutput(original), withoutOutput(next)),
  both: (original, latest, edited) =>
    mergeFields(original, latest, edited, 'operations', [], ['output']) as Layer,
  removed: () => undefined,
};

// Merge id-keyed lists. Draft order wins; entries the main project added are
// appended in its order.
function mergeEntries<T extends { readonly id: string }>(
  base: ReadonlyArray<T>,
  current: ReadonlyArray<T>,
  draft: ReadonlyArray<T>,
  rules: EntryRules<T>,
): T[] {
  const baseById = new Map(base.map((entry) => [entry.id, entry]));
  const currentById = new Map(current.map((entry) => [entry.id, entry]));
  const draftIds = new Set(draft.map((entry) => entry.id));
  const merged: T[] = [];
  for (const edited of draft) {
    const entry = mergeEntry(baseById.get(edited.id), currentById.get(edited.id), edited, rules);
    if (entry !== null) merged.push(entry);
  }
  for (const latest of current) {
    if (draftIds.has(latest.id)) continue;
    const original = baseById.get(latest.id);
    // Added in main: keep it. Removed in the draft: it stays removed, unless
    // the main project changed it meanwhile.
    if (original === undefined) merged.push(latest);
    else if (rules.changed(original, latest)) rules.removed();
  }
  return merged;
}

/** One draft entry against the version the editor opened and the main
 *  project's current one; null means the main project removed it. */
function mergeEntry<T extends { readonly id: string }>(
  original: T | undefined,
  latest: T | undefined,
  edited: T,
  rules: EntryRules<T>,
): T | null {
  if (original === undefined) {
    // Fresh ids cannot collide, so the same id added on both sides must agree.
    if (latest !== undefined && !same(latest, edited)) refuse(rules.conflict);
    return edited;
  }
  if (latest === undefined) {
    if (rules.changed(original, edited)) rules.removed();
    return null;
  }
  if (same(original, latest)) return edited;
  if (same(original, edited) || same(latest, edited)) return latest;
  return rules.both(original, latest, edited);
}

// Merge a presentation or run-order list: the draft's order, without what the
// main project removed, followed by what the main project added.
function mergeOrder<T>(
  base: ReadonlyArray<T>,
  current: ReadonlyArray<T>,
  draft: ReadonlyArray<T>,
  key: (entry: T) => string,
): ReadonlyArray<T> {
  const baseKeys = new Set(base.map(key));
  const currentKeys = new Set(current.map(key));
  const draftKeys = new Set(draft.map(key));
  return [
    ...draft.filter((entry) => !baseKeys.has(key(entry)) || currentKeys.has(key(entry))),
    ...current.filter((entry) => !baseKeys.has(key(entry)) && !draftKeys.has(key(entry))),
  ];
}

// A list one side left alone takes the other side's version. When both changed
// it, a list that appeared or disappeared on either side conflicts.
function mergeOptional<T>(
  base: ReadonlyArray<T> | undefined,
  current: ReadonlyArray<T> | undefined,
  draft: ReadonlyArray<T> | undefined,
  merge: (
    base: ReadonlyArray<T>,
    current: ReadonlyArray<T>,
    draft: ReadonlyArray<T>,
  ) => ReadonlyArray<T>,
): ReadonlyArray<T> | undefined {
  if (current === base) return draft;
  if (draft === base) return current;
  if (base === undefined || current === undefined || draft === undefined) refuse('artwork');
  return merge(base, current, draft);
}

// Three-way merge of an object's own fields. `skip` fields are the caller's;
// `currentWins` fields take the main project's value when both sides changed.
function mergeFields<T extends object>(
  base: T,
  current: T,
  draft: T,
  conflict: JigRebaseConflict,
  skip: ReadonlyArray<string>,
  currentWins: ReadonlyArray<string> = [],
): Record<string, unknown> {
  const b = base as Record<string, unknown>;
  const c = current as Record<string, unknown>;
  const d = draft as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(b), ...Object.keys(c), ...Object.keys(d)])) {
    if (skip.includes(key)) continue;
    const draftChanged = !same(b[key], d[key]);
    let source = draftChanged ? d : c;
    if (draftChanged && !same(b[key], c[key]) && !same(c[key], d[key])) {
      if (!currentWins.includes(key)) refuse(conflict);
      source = c;
    }
    if (key in source) result[key] = source[key];
  }
  return result;
}

function withoutOutput(layer: Layer): Omit<Layer, 'output'> {
  const { output: _output, ...rest } = layer;
  return rest;
}

// Editor copies are spreads of the originals, so an untouched entry keeps
// every field reference even when the entry itself was re-created.
function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null)
    return false;
  if (Array.isArray(left) || Array.isArray(right)) return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every((key) => key in b && a[key] === b[key])
  );
}
