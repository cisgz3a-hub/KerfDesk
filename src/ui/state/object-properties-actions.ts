import type { ObjectOperationOverride, Project, SceneObject, ShapeObject } from '../../core/scene';
import { rematerializeParametricShape, type ParametricShapeSpec } from '../../core/shapes';
import { pushUndo, type StateSlice } from './scene-mutations';

const MIN_POWER_SCALE_PERCENT = 0;
const MAX_POWER_SCALE_PERCENT = 100;

type ObjectPropertiesState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

type ObjectPropertiesChange = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
};

type ObjectPropertiesMutation = ObjectPropertiesChange | Record<string, never>;

type ObjectPropertiesSet = (fn: (state: ObjectPropertiesState) => ObjectPropertiesMutation) => void;

export type ObjectPropertiesActions = {
  readonly setSelectedObjectsPowerScale: (powerScale: number) => void;
  readonly setObjectsPowerScale: (objectIds: ReadonlyArray<string>, powerScale: number) => void;
  readonly setSelectedShapeSpec: (spec: ParametricShapeSpec) => void;
  readonly setShapeSpec: (objectId: string, spec: ParametricShapeSpec) => void;
  readonly setSelectedObjectsOperationOverride: (patch: ObjectOperationOverride) => void;
  readonly clearSelectedObjectsOperationOverride: () => void;
};

export function objectPropertiesActions(set: ObjectPropertiesSet): ObjectPropertiesActions {
  return {
    setSelectedObjectsPowerScale: (powerScale) =>
      set((state) => setObjectsPowerScale(state, selectedObjectIds(state), powerScale)),
    setObjectsPowerScale: (objectIds, powerScale) =>
      set((state) => setObjectsPowerScale(state, new Set(objectIds), powerScale)),
    setSelectedShapeSpec: (spec) =>
      set((state) =>
        state.selectedObjectId === null || state.additionalSelectedIds.size > 0
          ? {}
          : setShapeSpec(state, state.selectedObjectId, spec),
      ),
    setShapeSpec: (objectId, spec) => set((state) => setShapeSpec(state, objectId, spec)),
    setSelectedObjectsOperationOverride: (patch) =>
      setSelectedObjectsOperationOverrideMatching(set, patch),
    clearSelectedObjectsOperationOverride: () =>
      set((state) => {
        const ids = selectedObjectIds(state);
        if (ids.size === 0) return {};
        let changed = false;
        const objects = state.project.scene.objects.map((object) => {
          if (!ids.has(object.id) || object.operationOverride === undefined) return object;
          changed = true;
          const { operationOverride: _operationOverride, ...rest } = object;
          return rest;
        });
        if (!changed) return {};
        return {
          project: { ...state.project, scene: { ...state.project.scene, objects } },
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
  };
}

function setObjectsPowerScale(
  state: ObjectPropertiesState,
  ids: ReadonlySet<string>,
  powerScale: number,
): ObjectPropertiesMutation {
  if (ids.size === 0) return {};
  const clamped = clampPowerScale(powerScale);
  let changed = false;
  const objects = state.project.scene.objects.map((object) => {
    if (!ids.has(object.id)) return object;
    if ((object.powerScale ?? MAX_POWER_SCALE_PERCENT) === clamped) return object;
    changed = true;
    return { ...object, powerScale: clamped };
  });
  return changed ? mutation(state, objects) : {};
}

function setShapeSpec(
  state: ObjectPropertiesState,
  objectId: string,
  spec: ParametricShapeSpec,
): ObjectPropertiesMutation {
  const object = state.project.scene.objects.find((candidate) => candidate.id === objectId);
  if (!isEditableParametricShape(object) || object.locked === true) return {};
  const replacement = rematerializeParametricShape(object, spec);
  if (replacement === null || shapeSpecEqual(replacement, object)) return {};
  return mutation(
    state,
    state.project.scene.objects.map((candidate) =>
      candidate.id === object.id ? replacement : candidate,
    ),
  );
}

function mutation(
  state: ObjectPropertiesState,
  objects: ReadonlyArray<SceneObject>,
): ObjectPropertiesChange {
  return {
    project: { ...state.project, scene: { ...state.project.scene, objects } },
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function isEditableParametricShape(object: SceneObject | undefined): object is ShapeObject {
  return object?.kind === 'shape' && object.spec.kind !== 'polyline';
}

function shapeSpecEqual(left: ShapeObject, right: ShapeObject): boolean {
  return JSON.stringify(left.spec) === JSON.stringify(right.spec);
}

function setSelectedObjectsOperationOverrideMatching(
  set: ObjectPropertiesSet,
  patch: ObjectOperationOverride,
): void {
  set((state) => {
    const ids = selectedObjectIds(state);
    if (ids.size === 0) return {};
    const sanitized = sanitizeOperationOverridePatch(patch);
    if (Object.keys(sanitized).length === 0) return {};
    let changed = false;
    const objects = state.project.scene.objects.map((object) => {
      if (!ids.has(object.id)) return object;
      const operationOverride = { ...(object.operationOverride ?? {}), ...sanitized };
      if (operationOverrideEqual(object.operationOverride, operationOverride)) return object;
      changed = true;
      return { ...object, operationOverride };
    });
    if (!changed) return {};
    return {
      project: { ...state.project, scene: { ...state.project.scene, objects } },
      undoStack: pushUndo(state.project, state.undoStack),
      redoStack: [],
      dirty: true,
    };
  });
}

function selectedObjectIds(state: ObjectPropertiesState): Set<string> {
  return new Set([
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ]);
}

function clampPowerScale(value: number): number {
  if (!Number.isFinite(value)) return MAX_POWER_SCALE_PERCENT;
  return Math.max(MIN_POWER_SCALE_PERCENT, Math.min(MAX_POWER_SCALE_PERCENT, value));
}

function sanitizeOperationOverridePatch(patch: ObjectOperationOverride): ObjectOperationOverride {
  const out: Record<string, unknown> = {};
  if (patch.mode === 'line' || patch.mode === 'fill' || patch.mode === 'image')
    out.mode = patch.mode;
  setPercent(out, 'minPower', patch.minPower);
  setPercent(out, 'power', patch.power);
  setPositiveNumber(out, 'speed', patch.speed);
  setPositiveInteger(out, 'passes', patch.passes);
  setBoolean(out, 'airAssist', patch.airAssist);
  setFiniteNumber(out, 'kerfOffsetMm', patch.kerfOffsetMm);
  setBoolean(out, 'tabsEnabled', patch.tabsEnabled);
  setPositiveNumber(out, 'tabSizeMm', patch.tabSizeMm);
  setPositiveInteger(out, 'tabsPerShape', patch.tabsPerShape);
  setBoolean(out, 'tabSkipInnerShapes', patch.tabSkipInnerShapes);
  setFiniteNumber(out, 'hatchAngleDeg', patch.hatchAngleDeg);
  setPositiveNumber(out, 'hatchSpacingMm', patch.hatchSpacingMm);
  setNonNegativeNumber(out, 'fillOverscanMm', patch.fillOverscanMm);
  if (
    patch.fillStyle === 'scanline' ||
    patch.fillStyle === 'offset' ||
    patch.fillStyle === 'island'
  )
    out.fillStyle = patch.fillStyle;
  setBoolean(out, 'fillBidirectional', patch.fillBidirectional);
  setBoolean(out, 'fillCrossHatch', patch.fillCrossHatch);
  if (patch.ditherAlgorithm !== undefined) out.ditherAlgorithm = patch.ditherAlgorithm;
  setPositiveNumber(out, 'linesPerMm', patch.linesPerMm);
  setBoolean(out, 'imageBidirectional', patch.imageBidirectional);
  setBoolean(out, 'negativeImage', patch.negativeImage);
  setBoolean(out, 'passThrough', patch.passThrough);
  setNonNegativeNumber(out, 'dotWidthCorrectionMm', patch.dotWidthCorrectionMm);
  return out as ObjectOperationOverride;
}

function setPercent(out: Record<string, unknown>, key: string, value: number | undefined): void {
  if (value !== undefined) out[key] = clampPowerScale(value);
}

function setPositiveNumber(
  out: Record<string, unknown>,
  key: string,
  value: number | undefined,
): void {
  if (value !== undefined && Number.isFinite(value)) out[key] = Math.max(1, value);
}

function setPositiveInteger(
  out: Record<string, unknown>,
  key: string,
  value: number | undefined,
): void {
  if (value !== undefined && Number.isFinite(value)) out[key] = Math.max(1, Math.floor(value));
}

function setNonNegativeNumber(
  out: Record<string, unknown>,
  key: string,
  value: number | undefined,
): void {
  if (value !== undefined && Number.isFinite(value)) out[key] = Math.max(0, value);
}

function setFiniteNumber(
  out: Record<string, unknown>,
  key: string,
  value: number | undefined,
): void {
  if (value !== undefined && Number.isFinite(value)) out[key] = value;
}

function setBoolean(out: Record<string, unknown>, key: string, value: boolean | undefined): void {
  if (value !== undefined) out[key] = value;
}

function operationOverrideEqual(
  left: ObjectOperationOverride | undefined,
  right: ObjectOperationOverride | undefined,
): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}
