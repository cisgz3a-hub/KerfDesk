import {
  outlineNest,
  quickNest,
  type NestOutline,
  type OutlineNestItem,
  type NestPlacement,
  type NestRect,
  type NestRotation,
  nestRotation,
  validateNest,
} from '../../core/nesting';
import {
  layoutNest,
  type NestGoal,
  type NestingInput,
  type NestLayout,
} from '../../core/nesting/layout-nest';
import {
  boardFitRegion,
  combinedBBox,
  findRegistrationBoxes,
  sceneObjectHasVisibleLayer,
  transformedBBox,
  type SceneObject,
} from '../../core/scene';
import { pushUndo } from './scene-mutations';
import { outlineForNestUnit } from './nest-outline';
import type { AppState } from './store';

export type QuickNestOptions = {
  readonly bin: 'workspace' | 'board';
  readonly padding: number;
  readonly allowRotation: boolean;
  readonly method: 'fast' | 'outline';
  readonly goal?: NestGoal;
  readonly rotationAngles?: ReadonlyArray<NestRotation>;
  readonly keepGrain?: boolean;
  readonly optimise?: boolean;
};

export type QuickNestActionResult =
  | {
      readonly ok: true;
      readonly packedUnits: number;
      readonly boundsFallbackUnits?: number;
    }
  | { readonly ok: false; readonly reason: string };

export type NestActions = {
  readonly quickNestSelection: (options: QuickNestOptions) => QuickNestActionResult;
  readonly prepareNestSelection: (options: QuickNestOptions) => PreparedNestResult;
  readonly acceptNestSelection: (draft: PreparedNest, layout: NestLayout) => QuickNestActionResult;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function nestActions(set: Setter, get: () => AppState): NestActions {
  return {
    prepareNestSelection: (options) => prepareNest(get(), options),
    acceptNestSelection: (draft, layout) => {
      if (get().project !== draft.project)
        return {
          ok: false,
          reason: 'Artwork changed. Calculate a fresh nest before accepting it.',
        };
      const items = layout.usedOutline
        ? draft.input.items
        : draft.input.items.map(({ outline: _outline, ...item }) => item);
      if (!validateNest(draft.input.bin, items, layout.placements, draft.input)) {
        return {
          ok: false,
          reason: 'The nesting draft no longer has valid containment, spacing or rotations.',
        };
      }
      const plan = {
        ...draft,
        placements: layout.placements,
        boundsFallbackUnits: layout.boundsFallbackUnits,
      };
      let applied = false;
      set((state) => {
        if (state.project !== draft.project) return state;
        applied = true;
        return applyNestPlan(state, plan);
      });
      return applied
        ? {
            ok: true,
            packedUnits: layout.placements.length,
            ...(layout.boundsFallbackUnits === 0
              ? {}
              : { boundsFallbackUnits: layout.boundsFallbackUnits }),
          }
        : { ok: false, reason: 'Artwork changed. Calculate a fresh nest before accepting it.' };
    },
    quickNestSelection: (options) => {
      const planned = planNest(get(), options);
      if (!planned.ok) return planned;
      set((state) => applyNestPlan(state, planned));
      return {
        ok: true,
        packedUnits: planned.placements.length,
        ...(planned.boundsFallbackUnits === 0
          ? {}
          : { boundsFallbackUnits: planned.boundsFallbackUnits }),
      };
    },
  };
}

type NestUnit = {
  readonly id: string;
  readonly objects: ReadonlyArray<SceneObject>;
  readonly bounds: NestRect;
  readonly outline?: NestOutline;
};

export type PreparedNest = {
  readonly ok: true;
  readonly project: AppState['project'];
  readonly units: ReadonlyArray<NestUnit>;
  readonly input: NestingInput;
};
export type PreparedNestResult =
  | PreparedNest
  | Extract<QuickNestActionResult, { readonly ok: false }>;

type NestPlan =
  | {
      readonly ok: true;
      readonly project: AppState['project'];
      readonly units: ReadonlyArray<NestUnit>;
      readonly placements: ReadonlyArray<NestPlacement>;
      readonly boundsFallbackUnits: number;
    }
  | Extract<QuickNestActionResult, { readonly ok: false }>;

function planNest(state: AppState, options: QuickNestOptions): NestPlan {
  const draft = prepareNest(state, options);
  if (!draft.ok) return draft;
  const { units, input } = draft;
  if (options.goal !== undefined) {
    const result = layoutNest(input);
    return result === null
      ? { ok: false, reason: `${units.length} selected unit(s) do not fit.` }
      : {
          ...draft,
          placements: result.placements,
          boundsFallbackUnits: result.boundsFallbackUnits,
        };
  }
  const result =
    options.method === 'outline'
      ? outlineNest(input.bin, input.items, input)
      : quickNest(input.bin, input.items, input);
  const boundsFallbackUnits =
    options.method !== 'outline'
      ? 0
      : result.ok && 'usedOutline' in result && !result.usedOutline
        ? units.length
        : units.filter((unit) => unit.outline === undefined).length;
  return result.ok
    ? { ...draft, placements: result.placements, boundsFallbackUnits }
    : { ok: false, reason: `${result.unplacedIds.length} selected unit(s) do not fit.` };
}

function prepareNest(state: AppState, options: QuickNestOptions): PreparedNestResult {
  if (!Number.isFinite(options.padding) || options.padding < 0)
    return { ok: false, reason: 'Enter a finite, non-negative part spacing.' };
  const rotationAngles = requestedNestAngles(options);
  if (rotationAngles.length === 0)
    return {
      ok: false,
      reason: 'Choose at least one permitted rotation that respects the grain restriction.',
    };
  const selectedIds = new Set([
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ]);
  const movableIds = new Set(
    state.project.scene.objects
      .filter(
        (object) =>
          selectedIds.has(object.id) &&
          object.locked !== true &&
          sceneObjectHasVisibleLayer(state.project.scene, object),
      )
      .map((object) => object.id),
  );
  if (hasPartialMovableGroup(state, movableIds))
    return {
      ok: false,
      reason:
        'Select every member of each group and unlock/show it before nesting. Groups must stay rigid.',
    };
  const units = nestUnits(state, movableIds);
  if (units.length === 0) return { ok: false, reason: 'Select unlocked visible artwork to nest.' };
  const bin = resolveBin(state, options.bin);
  if (bin === null) return { ok: false, reason: 'Place a board before nesting into the board.' };
  const binBoxId =
    options.bin === 'board' ? findRegistrationBoxes(state.project.scene)[0]?.id : undefined;
  const obstacles = state.project.scene.objects
    .filter((object) => object.locked === true && object.id !== binBoxId)
    .map(transformedBBox);
  const items = units.map(
    (unit): OutlineNestItem => ({
      id: unit.id,
      width: unit.bounds.maxX - unit.bounds.minX,
      height: unit.bounds.maxY - unit.bounds.minY,
      canRotate: options.allowRotation,
      rotationAngles,
      ...(unit.outline === undefined ? {} : { outline: unit.outline }),
    }),
  );
  return {
    ok: true,
    project: state.project,
    units,
    input: {
      bin,
      items,
      padding: options.padding,
      obstacles,
      goal: options.goal ?? 'compact',
      method: options.method,
      optimise: options.optimise ?? false,
    },
  };
}

function applyNestPlan(
  state: AppState,
  plan: Extract<NestPlan, { readonly ok: true }>,
): AppState | Partial<AppState> {
  if (state.project !== plan.project) return state;
  const transformed = new Map<string, SceneObject>();
  for (const placement of plan.placements) {
    const unit = plan.units.find((candidate) => candidate.id === placement.id);
    if (unit === undefined) continue;
    for (const object of placeUnit(unit, placement)) transformed.set(object.id, object);
  }
  if (transformed.size === 0) return state;
  return {
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects: state.project.scene.objects.map((object) => transformed.get(object.id) ?? object),
      },
    },
    undoStack: pushUndo(state.project, state.undoStack, 'Quick Nest'),
    redoStack: [],
    dirty: true,
  };
}

function nestUnits(state: AppState, movableIds: ReadonlySet<string>): NestUnit[] {
  const consumed = new Set<string>();
  const neighbours = rigidGroupNeighbours(state, movableIds);
  const units: NestUnit[] = [];
  for (const object of state.project.scene.objects) {
    if (!movableIds.has(object.id) || consumed.has(object.id)) continue;
    const members = rigidGroupMembers(object.id, neighbours);
    members.forEach((id) => consumed.add(id));
    const objects = state.project.scene.objects.filter((item) => members.has(item.id));
    const bounds = combinedBBox(objects);
    if (bounds === null) continue;
    const groupIds = (state.project.scene.groups ?? [])
      .filter(
        (group) => group.objectIds.length > 1 && group.objectIds.every((id) => members.has(id)),
      )
      .map((group) => group.id);
    units.push({
      id: groupIds.length === 0 ? 'object:' + object.id : 'group:' + groupIds.sort().join('+'),
      objects,
      bounds,
      ...outlineForNestUnit(objects, bounds),
    });
  }
  return units;
}
function hasPartialMovableGroup(state: AppState, movableIds: ReadonlySet<string>): boolean {
  return (state.project.scene.groups ?? []).some(
    (group) =>
      group.objectIds.length > 1 &&
      group.objectIds.some((id) => movableIds.has(id)) &&
      !group.objectIds.every((id) => movableIds.has(id)),
  );
}
function rigidGroupNeighbours(
  state: AppState,
  movableIds: ReadonlySet<string>,
): ReadonlyMap<string, ReadonlySet<string>> {
  const neighbours = new Map<string, Set<string>>();
  for (const group of state.project.scene.groups ?? []) {
    const first = group.objectIds[0];
    if (first === undefined || !group.objectIds.every((id) => movableIds.has(id))) continue;
    for (const id of group.objectIds) {
      const from = neighbours.get(first) ?? new Set<string>();
      from.add(id);
      neighbours.set(first, from);
      const to = neighbours.get(id) ?? new Set<string>();
      to.add(first);
      neighbours.set(id, to);
    }
  }
  return neighbours;
}
function rigidGroupMembers(
  first: string,
  neighbours: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlySet<string> {
  const members = new Set<string>(),
    pending = [first];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || members.has(id)) continue;
    members.add(id);
    for (const other of neighbours.get(id) ?? []) if (!members.has(other)) pending.push(other);
  }
  return members;
}

function placeUnit(unit: NestUnit, placement: NestPlacement): SceneObject[] {
  const angle = nestRotation(placement);
  const rotated = angle !== 0 ? rotateUnit(unit, angle) : [...unit.objects];
  const rotatedBounds = combinedBBox(rotated);
  if (rotatedBounds === null) return rotated;
  const dx = placement.x - rotatedBounds.minX;
  const dy = placement.y - rotatedBounds.minY;
  return rotated.map((object) => ({
    ...object,
    transform: { ...object.transform, x: object.transform.x + dx, y: object.transform.y + dy },
  })) as SceneObject[];
}

function rotateUnit(unit: NestUnit, angle: NestRotation): SceneObject[] {
  const center = {
    x: (unit.bounds.minX + unit.bounds.maxX) / 2,
    y: (unit.bounds.minY + unit.bounds.maxY) / 2,
  };
  const cos = angle === 180 ? -1 : 0;
  const sin = angle === 90 ? 1 : angle === 270 ? -1 : 0;
  return unit.objects.map((object) => {
    const dx = object.transform.x - center.x;
    const dy = object.transform.y - center.y;
    return {
      ...object,
      transform: {
        ...object.transform,
        x: center.x + dx * cos - dy * sin,
        y: center.y + dx * sin + dy * cos,
        rotationDeg: (object.transform.rotationDeg + angle) % 360,
      },
    } as SceneObject;
  });
}

function resolveBin(state: AppState, kind: QuickNestOptions['bin']): NestRect | null {
  if (kind === 'workspace') {
    return {
      minX: 0,
      minY: 0,
      maxX: state.project.workspace.width,
      maxY: state.project.workspace.height,
    };
  }
  const board = findRegistrationBoxes(state.project.scene)[0];
  return board === undefined ? null : boardFitRegion(board);
}

function requestedNestAngles(options: QuickNestOptions): ReadonlyArray<NestRotation> {
  if (!options.allowRotation) return [0];
  return (options.rotationAngles ?? (options.allowRotation ? [0, 90] : [0])).filter(
    (angle): angle is NestRotation =>
      [0, 90, 180, 270].includes(angle) && (!options.keepGrain || angle % 180 === 0),
  );
}
