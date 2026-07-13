import { isVectorPathObject, materializeVectorObject } from '../../core/geometry';
import {
  outlineNest,
  quickNest,
  type NestOutline,
  type OutlineNestItem,
  type NestPlacement,
  type NestRect,
} from '../../core/nesting';
import {
  boardFitRegion,
  combinedBBox,
  findRegistrationBoxes,
  sceneObjectHasVisibleLayer,
  transformedBBox,
  type SceneObject,
} from '../../core/scene';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

export type QuickNestOptions = {
  readonly bin: 'workspace' | 'board';
  readonly padding: number;
  readonly allowRotation: boolean;
  readonly method: 'fast' | 'outline';
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
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function nestActions(set: Setter, get: () => AppState): NestActions {
  return {
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
      ...(unit.outline === undefined ? {} : { outline: unit.outline }),
    }),
  );
  const nestOptions = { padding: options.padding, obstacles };
  const result =
    options.method === 'outline'
      ? outlineNest(bin, items, nestOptions)
      : quickNest(bin, items, nestOptions);
  const boundsFallbackUnits =
    options.method !== 'outline'
      ? 0
      : result.ok && 'usedOutline' in result && !result.usedOutline
        ? units.length
        : units.filter((unit) => unit.outline === undefined).length;
  return result.ok
    ? {
        ok: true,
        project: state.project,
        units,
        placements: result.placements,
        boundsFallbackUnits,
      }
    : { ok: false, reason: `${result.unplacedIds.length} selected unit(s) do not fit.` };
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
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function nestUnits(state: AppState, movableIds: ReadonlySet<string>): NestUnit[] {
  const consumed = new Set<string>();
  const units: NestUnit[] = [];
  for (const group of state.project.scene.groups ?? []) {
    if (group.objectIds.length < 2 || !group.objectIds.every((id) => movableIds.has(id))) continue;
    const objects = state.project.scene.objects.filter((object) =>
      group.objectIds.includes(object.id),
    );
    const bounds = combinedBBox(objects);
    if (bounds === null) continue;
    units.push({
      id: `group:${group.id}`,
      objects,
      bounds,
      ...outlineForUnit(objects, bounds),
    });
    group.objectIds.forEach((id) => consumed.add(id));
  }
  for (const object of state.project.scene.objects) {
    if (!movableIds.has(object.id) || consumed.has(object.id)) continue;
    const bounds = transformedBBox(object);
    units.push({
      id: `object:${object.id}`,
      objects: [object],
      bounds,
      ...outlineForUnit([object], bounds),
    });
  }
  return units;
}

function outlineForUnit(
  objects: ReadonlyArray<SceneObject>,
  bounds: NestRect,
): { readonly outline?: NestOutline } {
  const outline: Array<Array<{ readonly x: number; readonly y: number }>> = [];
  let pointCount = 0;
  for (const object of objects) {
    if (!isVectorPathObject(object)) return {};
    const materialized = materializeVectorObject(object);
    for (const path of materialized.paths) {
      for (const polyline of path.polylines) {
        if (!polyline.closed || polyline.points.length < 3) return {};
        pointCount += polyline.points.length;
        if (pointCount > MAX_OUTLINE_POINTS_PER_UNIT) return {};
        outline.push(
          polyline.points.map((point) => ({
            x: point.x - bounds.minX,
            y: point.y - bounds.minY,
          })),
        );
      }
    }
  }
  return outline.length === 0 ? {} : { outline };
}

const MAX_OUTLINE_POINTS_PER_UNIT = 20_000;

function placeUnit(unit: NestUnit, placement: NestPlacement): SceneObject[] {
  const rotated = placement.rotated90 ? rotateUnit90(unit) : [...unit.objects];
  const rotatedBounds = combinedBBox(rotated);
  if (rotatedBounds === null) return rotated;
  const dx = placement.x - rotatedBounds.minX;
  const dy = placement.y - rotatedBounds.minY;
  return rotated.map((object) => ({
    ...object,
    transform: { ...object.transform, x: object.transform.x + dx, y: object.transform.y + dy },
  })) as SceneObject[];
}

function rotateUnit90(unit: NestUnit): SceneObject[] {
  const center = {
    x: (unit.bounds.minX + unit.bounds.maxX) / 2,
    y: (unit.bounds.minY + unit.bounds.maxY) / 2,
  };
  return unit.objects.map((object) => {
    const dx = object.transform.x - center.x;
    const dy = object.transform.y - center.y;
    return {
      ...object,
      transform: {
        ...object.transform,
        x: center.x - dy,
        y: center.y + dx,
        rotationDeg: (object.transform.rotationDeg + 90) % 360,
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
