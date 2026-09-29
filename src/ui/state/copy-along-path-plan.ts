// Copy Along Path (LightBurn gap LBG-T09): the guide, the artwork and the copy
// placements for a request, or the reason there are none. The dialog shows a
// preview worked out the same way, without laying the copies out.
//
// How many copies there can be is limited only by the project: a project holds
// at most PROJECT_SCENE_LIMITS.objects objects and cannot be reopened above
// that, so a request for more than fit is explained and not applied
// (ADR-498 amendment 1). Nothing else caps the count.

import {
  copyAlongPathCount,
  copyAlongPathLayout,
  type CopyAlongPathShortfall,
  type CopyAlongPathSpec,
} from '../../core/geometry/copy-along-path';
import {
  splitCopyAlongPathSelection,
  type CopyAlongPathSelection,
} from '../../core/geometry/copy-along-path-guide';
import type { ArrayPlacement } from '../../core/scene/array-layout';
import { combinedBBox } from '../../core/scene/hit-test';
import type { Scene } from '../../core/scene/scene';
import type { Bounds, SceneObject } from '../../core/scene/scene-object';
import { PROJECT_SCENE_LIMITS } from '../../io/project/project-scene-integrity-validator';
import { formatDisplayMillimetres } from '../format-display-millimetres';
import { sceneObjectCopyClosure } from './scene-object-copy-dependencies';

export type CopyAlongPathRequest = CopyAlongPathSpec & {
  /** One of the selected single paths; the top-most one when absent. */
  readonly guideId?: string;
  /** Leave the artwork where it was, or replace it with the copies. */
  readonly keepOriginal: boolean;
};

export type ReadyCopyAlongPathSelection = Extract<CopyAlongPathSelection, { kind: 'ok' }>;

export type CopyAlongPathPlan =
  | {
      readonly kind: 'ready';
      readonly selection: ReadyCopyAlongPathSelection;
      readonly placements: ReadonlyArray<ArrayPlacement>;
      readonly stepMm: number | null;
    }
  | { readonly kind: 'problem'; readonly message: string };

/** What the dialog says Apply will do: how many copies and how far apart, with none of them laid out. */
export type CopyAlongPathPreview =
  | {
      readonly kind: 'ready';
      readonly selection: ReadyCopyAlongPathSelection;
      readonly count: number;
      readonly stepMm: number | null;
    }
  | { readonly kind: 'problem'; readonly message: string };

type Problem = { readonly kind: 'problem'; readonly message: string };
type Target = {
  readonly kind: 'target';
  readonly selection: ReadyCopyAlongPathSelection;
  readonly bounds: Bounds;
};

/**
 * `selected` in stacking order; `scene` is the project's, for how many copies
 * it has room for.
 */
export function planCopyAlongPath(
  selected: ReadonlyArray<SceneObject>,
  request: CopyAlongPathRequest,
  scene: Scene,
): CopyAlongPathPlan {
  const selection = splitCopyAlongPathSelection(selected, request.guideId);
  const room = copyAlongPathRoom(scene, selection, request.keepOriginal);
  return planForSelection(selection, request, room);
}

/** The plan, with every placement, for a selection already split into guide and artwork; `room` is the most copies it may have. */
export function planForSelection(
  selection: CopyAlongPathSelection,
  request: CopyAlongPathRequest,
  room: number,
): CopyAlongPathPlan {
  const target = layoutTarget(selection);
  if (target.kind === 'problem') return target;
  const layout = copyAlongPathLayout(target.selection.guide, target.bounds, request, room);
  if (layout.kind !== 'placed') return shortfall(layout, request, target.selection, room);
  return {
    kind: 'ready',
    selection: target.selection,
    placements: layout.placements,
    stepMm: layout.stepMm,
  };
}

/** The dialog's preview: the same answer as the plan, without the placements. */
export function previewForSelection(
  selection: CopyAlongPathSelection,
  request: CopyAlongPathRequest,
  room: number,
): CopyAlongPathPreview {
  const target = layoutTarget(selection);
  if (target.kind === 'problem') return target;
  const counted = copyAlongPathCount(target.selection.guide, target.bounds, request, room);
  if (counted.kind !== 'counted') return shortfall(counted, request, target.selection, room);
  return {
    kind: 'ready',
    selection: target.selection,
    count: counted.count,
    stepMm: counted.stepMm,
  };
}

/**
 * How many copies the project has room for: the most that keep its scene under
 * the object limit it can be saved and reopened with, the limit the jig editor
 * and the SVG and library inserts keep to. A copy is the artwork and whatever
 * it needs with it, and the originals give their places back when they are not
 * kept. Groups and group members follow: a copied group has two or more
 * objects, and an object is in one group at most.
 */
export function copyAlongPathRoom(
  scene: Scene,
  selection: CopyAlongPathSelection,
  keepOriginal: boolean,
): number {
  if (selection.kind !== 'ok') return 0;
  const artworkIds = new Set(selection.artwork.map((object) => object.id));
  const perCopy = sceneObjectCopyClosure(scene.objects, artworkIds).length;
  const retained = scene.objects.length - (keepOriginal ? 0 : artworkIds.size);
  const free = PROJECT_SCENE_LIMITS.objects - retained;
  return Math.max(0, Math.floor(free / Math.max(1, perCopy)));
}

/** Why this selection cannot be copied along a path, or null when it can. */
export function copyAlongPathSelectionProblem(selected: ReadonlyArray<SceneObject>): string | null {
  const selection = splitCopyAlongPathSelection(selected);
  return selection.kind === 'ok' ? null : selectionProblem(selection);
}

const NO_ARTWORK = 'Select the artwork to copy as well as the guide path.';

function layoutTarget(selection: CopyAlongPathSelection): Target | Problem {
  if (selection.kind !== 'ok') return { kind: 'problem', message: selectionProblem(selection) };
  const bounds = combinedBBox(selection.artwork);
  if (bounds === null) return { kind: 'problem', message: NO_ARTWORK };
  return { kind: 'target', selection, bounds };
}

function selectionProblem(selection: Exclude<CopyAlongPathSelection, { kind: 'ok' }>): string {
  switch (selection.kind) {
    case 'no-guide':
      return 'Copy Along Path needs a guide: select the artwork and one open or closed path to copy it along. Text and barcodes are never the guide.';
    case 'zero-length':
      return 'The guide path has no length to copy along.';
    case 'no-artwork':
      return NO_ARTWORK;
  }
}

function shortfall(
  reason: CopyAlongPathShortfall,
  request: CopyAlongPathRequest,
  selection: ReadyCopyAlongPathSelection,
  room: number,
): Problem {
  return { kind: 'problem', message: shortfallMessage(reason.kind, request, selection, room) };
}

function shortfallMessage(
  kind: CopyAlongPathShortfall['kind'],
  request: CopyAlongPathRequest,
  selection: ReadyCopyAlongPathSelection,
  room: number,
): string {
  switch (kind) {
    case 'no-room': {
      const length = formatDisplayMillimetres(selection.guide.walk.lengthMm);
      return `The start and end offsets leave no room on the ${length} mm guide path.`;
    }
    case 'no-step':
      return `The copies would all land in one place. Set a ${settingName(request)} above 0 mm.`;
    case 'too-many':
      return tooManyMessage(request, room);
  }
}

function tooManyMessage(request: CopyAlongPathRequest, room: number): string {
  const limit = `project limit ${PROJECT_SCENE_LIMITS.objects} objects`;
  if (room < 1) {
    return `This project has no room for another copy of this artwork (${limit}). Delete some objects first.`;
  }
  const copies = room === 1 ? '1 more copy' : `${room} more copies`;
  const holds = `This project has room for at most ${copies} of this artwork (${limit})`;
  if (request.mode === 'count') return `${holds}. Ask for fewer copies.`;
  const setting = settingName(request);
  return `${holds}, and that ${setting} places more. Set a larger ${setting}.`;
}

function settingName(request: CopyAlongPathRequest): 'gap' | 'spacing' {
  return request.mode === 'gap' ? 'gap' : 'spacing';
}
