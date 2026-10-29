import {
  layerFromSubLayer,
  sceneObjectUsesOperation,
  type Layer,
  type ObjectOperationOverride,
  type Project,
  type SceneObject,
  type ShapeObject,
} from '../../core/scene';
import {
  effectiveOperationForObject,
  operationOverrideForObject,
} from '../../core/effective-output';
import {
  leadStyleFor,
  maxLeadAngleDeg,
  MIN_LEAD_ANGLE_DEG,
  MIN_LEAD_LENGTH_MM,
} from '../../core/job/laser-lead-settings';
import type { ParametricShapeSpec } from '../../core/shapes';
import { rematerializeShapeSpecEdit } from '../../core/shapes/rectangle-resize';
import { movedTabsNotice } from './path-node-edit-actions';
import { pushUndo, type StateSlice } from './scene-mutations';
import { useToastStore } from './toast-store';

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
  readonly setObjectsOperationOverrideForOperation: (
    objectIds: ReadonlyArray<string>,
    operationId: string,
    patch: ObjectOperationOverride,
  ) => void;
  readonly clearSelectedObjectsOperationOverride: () => void;
};

export function objectPropertiesActions(set: ObjectPropertiesSet): ObjectPropertiesActions {
  return {
    setSelectedObjectsPowerScale: (powerScale) =>
      set((state) => setObjectsPowerScale(state, selectedObjectIds(state), powerScale)),
    setObjectsPowerScale: (objectIds, powerScale) =>
      set((state) => setObjectsPowerScale(state, new Set(objectIds), powerScale)),
    setSelectedShapeSpec: (spec) =>
      setShapeSpecWithNotice(set, (state, movedTabs) =>
        state.selectedObjectId === null || state.additionalSelectedIds.size > 0
          ? {}
          : setShapeSpec(state, state.selectedObjectId, spec, movedTabs),
      ),
    setShapeSpec: (objectId, spec) =>
      setShapeSpecWithNotice(set, (state, movedTabs) =>
        setShapeSpec(state, objectId, spec, movedTabs),
      ),
    setSelectedObjectsOperationOverride: (patch) =>
      set((state) => setObjectsOperationOverride(state, selectedObjectIds(state), patch)),
    setObjectsOperationOverrideForOperation: (objectIds, operationId, patch) =>
      set((state) => setObjectsOperationOverride(state, new Set(objectIds), patch, operationId)),
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

// Tabs placed by hand follow the new size; a tab the new outline took off its
// stretched place moved to the nearest point of it, and the note says so
// (ADR-494 Amendment 3).
function setShapeSpec(
  state: ObjectPropertiesState,
  objectId: string,
  spec: ParametricShapeSpec,
  movedTabs: { count: number },
): ObjectPropertiesMutation {
  const object = state.project.scene.objects.find((candidate) => candidate.id === objectId);
  if (!isEditableParametricShape(object) || object.locked === true) return {};
  const edit = rematerializeShapeSpecEdit(object, spec);
  if (edit === null || shapeSpecEqual(edit.object, object)) return {};
  movedTabs.count = edit.moved;
  return mutation(
    state,
    state.project.scene.objects.map((candidate) =>
      candidate.id === object.id ? edit.object : candidate,
    ),
  );
}

function setShapeSpecWithNotice(
  set: ObjectPropertiesSet,
  edit: (state: ObjectPropertiesState, movedTabs: { count: number }) => ObjectPropertiesMutation,
): void {
  const movedTabs = { count: 0 };
  set((state) => edit(state, movedTabs));
  const notice = movedTabsNotice(movedTabs.count);
  if (notice !== '') useToastStore.getState().pushToast(notice, 'info');
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
  return (
    object?.kind === 'shape' && object.spec.kind !== 'polyline' && object.spec.kind !== 'barcode'
  );
}

function shapeSpecEqual(left: ShapeObject, right: ShapeObject): boolean {
  return JSON.stringify(left.spec) === JSON.stringify(right.spec);
}

function setObjectsOperationOverride(
  state: ObjectPropertiesState,
  ids: ReadonlySet<string>,
  patch: ObjectOperationOverride,
  operationId?: string,
): ObjectPropertiesMutation {
  const project = projectWithOperationOverride(state.project, ids, patch, operationId);
  if (project === state.project) return {};
  return {
    project,
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

/** The project with `patch` written into each artwork's own settings, or the
 * same project when nothing changes. Exported so an action that edits an
 * operation and its artwork owners together records one undo step. */
export function projectWithOperationOverride(
  project: Project,
  ids: ReadonlySet<string>,
  patch: ObjectOperationOverride,
  operationId?: string,
): Project {
  if (ids.size === 0) return project;
  const sanitized = sanitizeOperationOverridePatch(patch);
  if (Object.keys(sanitized).length === 0) return project;
  const operations =
    operationId === undefined
      ? []
      : project.scene.layers
          .flatMap((layer) => [
            layer,
            ...layer.subLayers.map((sub) => layerFromSubLayer(layer, sub)),
          ])
          .filter((layer) => layer.id === operationId);
  if (operationId !== undefined && operations.length !== 1) return project;
  const operation = operations[0];
  let changed = false;
  const objects = project.scene.objects.map((object) => {
    if (
      !ids.has(object.id) ||
      (operation !== undefined && !sceneObjectUsesOperation(object, operation))
    )
      return object;
    const objectPatch = reconcileArtworkBounds(sanitized, operation, object);
    const operationOverride =
      operation === undefined
        ? { ...(object.operationOverride ?? {}), ...objectPatch }
        : {
            ...object.operationOverride,
            byOperation: {
              ...object.operationOverride?.byOperation,
              [operation.id]: { ...operationOverrideForObject(operation, object), ...objectPatch },
            },
          };
    if (operationOverrideEqual(object.operationOverride, operationOverride)) return object;
    changed = true;
    return { ...object, operationOverride };
  });
  return changed ? { ...project, scene: { ...project.scene, objects } } : project;
}

function reconcileArtworkBounds(
  patch: ObjectOperationOverride,
  operation: Layer | undefined,
  object: SceneObject,
): ObjectOperationOverride {
  if (operation === undefined) return patch;
  const current = effectiveOperationForObject(operation, object);
  const next = { ...patch };
  // A bulk edit respects each artwork's own ceiling. Only change a dependent
  // field when the edit requires it; never copy the first artwork's values.
  if (patch.power !== undefined || patch.minPower !== undefined) {
    const maximum = patch.power ?? current.power;
    const minimum = patch.minPower ?? current.minPower;
    if (minimum > maximum) next.minPower = maximum;
  }
  if (patch.linesPerMm !== undefined || patch.dotWidthCorrectionMm !== undefined) {
    const maximum = 1 / Math.max(1, patch.linesPerMm ?? current.linesPerMm);
    const width = patch.dotWidthCorrectionMm ?? current.dotWidthCorrectionMm;
    if (width > maximum) next.dotWidthCorrectionMm = maximum;
  }
  reconcileLeadAngle(patch, current, next);
  return next;
}

// ADR-626: an arc lead turns up to 180 degrees, a line lead meets the cut at
// up to 90. A bulk edit of the angle alone keeps each artwork's angle within
// its own style's range, as the artwork's settings then show.
function reconcileLeadAngle(
  patch: ObjectOperationOverride,
  current: Layer,
  next: Record<string, unknown>,
): void {
  if (patch.leadAngleDeg === undefined && patch.leadStyle === undefined) return;
  const style = patch.leadStyle ?? leadStyleFor(current);
  const angle = patch.leadAngleDeg ?? current.leadAngleDeg;
  if (angle === undefined) return;
  const within = Math.min(maxLeadAngleDeg(style), Math.max(MIN_LEAD_ANGLE_DEG, angle));
  if (within !== angle) next.leadAngleDeg = within;
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
  setPowerMode(out, patch);
  setPercent(out, 'minPower', patch.minPower);
  setPercent(out, 'power', patch.power);
  setPositiveNumber(out, 'speed', patch.speed);
  setPositiveInteger(out, 'passes', patch.passes);
  setBoolean(out, 'airAssist', patch.airAssist);
  setFiniteNumber(out, 'kerfOffsetMm', patch.kerfOffsetMm);
  setBoolean(out, 'tabsEnabled', patch.tabsEnabled);
  setMinimumNumber(out, 'tabSizeMm', patch.tabSizeMm, 0.01);
  setPositiveInteger(out, 'tabsPerShape', patch.tabsPerShape);
  setBoolean(out, 'tabSkipInnerShapes', patch.tabSkipInnerShapes);
  setFiniteNumber(out, 'hatchAngleDeg', patch.hatchAngleDeg);
  setMinimumNumber(out, 'hatchSpacingMm', patch.hatchSpacingMm, 0.05);
  setNonNegativeNumber(out, 'fillOverscanMm', patch.fillOverscanMm);
  if (
    patch.fillStyle === 'scanline' ||
    patch.fillStyle === 'offset' ||
    patch.fillStyle === 'island'
  )
    out.fillStyle = patch.fillStyle;
  setBoolean(out, 'fillBidirectional', patch.fillBidirectional);
  setBoolean(out, 'allowUncalibratedBidirectionalScan', patch.allowUncalibratedBidirectionalScan);
  setFiniteNumber(out, 'bidirectionalScanOffsetMm', patch.bidirectionalScanOffsetMm);
  setBoolean(out, 'fillCrossHatch', patch.fillCrossHatch);
  if (patch.ditherAlgorithm !== undefined) out.ditherAlgorithm = patch.ditherAlgorithm;
  setPositiveNumber(out, 'linesPerMm', patch.linesPerMm);
  setBoolean(out, 'imageBidirectional', patch.imageBidirectional);
  setBoolean(out, 'negativeImage', patch.negativeImage);
  setBoolean(out, 'passThrough', patch.passThrough);
  setNonNegativeNumber(out, 'dotWidthCorrectionMm', patch.dotWidthCorrectionMm);
  setBoolean(out, 'perforationEnabled', patch.perforationEnabled);
  setMinimumNumber(out, 'perforationCutMm', patch.perforationCutMm, 0.01);
  setMinimumNumber(out, 'perforationSkipMm', patch.perforationSkipMm, 0.01);
  setNonNegativeNumber(out, 'overcutMm', patch.overcutMm);
  setNonNegativeNumber(out, 'imageOverscanMm', patch.imageOverscanMm);
  setTabLayoutFields(out, patch);
  setFiniteNumber(out, 'imageScanAngleDeg', patch.imageScanAngleDeg);
  setBoolean(out, 'imageCrossHatch', patch.imageCrossHatch);
  setFiniteNumber(out, 'passAngleStepDeg', patch.passAngleStepDeg);
  setBoolean(out, 'autoOverscan', patch.autoOverscan);
  setLeadFields(out, patch);
  return out as ObjectOperationOverride;
}

// ADR-626 lead-in and lead-out.
function setLeadFields(out: Record<string, unknown>, patch: ObjectOperationOverride): void {
  setBoolean(out, 'leadInEnabled', patch.leadInEnabled);
  setBoolean(out, 'leadOutEnabled', patch.leadOutEnabled);
  if (patch.leadStyle === 'arc' || patch.leadStyle === 'line') out.leadStyle = patch.leadStyle;
  setMinimumNumber(out, 'leadLengthMm', patch.leadLengthMm, MIN_LEAD_LENGTH_MM);
  setFiniteNumber(out, 'leadAngleDeg', patch.leadAngleDeg);
  if (patch.leadSide === 'auto' || patch.leadSide === 'outside' || patch.leadSide === 'inside')
    out.leadSide = patch.leadSide;
}

// ADR-494 tab layout and tab power.
function setTabLayoutFields(out: Record<string, unknown>, patch: ObjectOperationOverride): void {
  if (patch.tabLayout === 'count' || patch.tabLayout === 'spacing') out.tabLayout = patch.tabLayout;
  setMinimumNumber(out, 'tabSpacingMm', patch.tabSpacingMm, 0.01);
  const maxPerShape = patch.tabMaxPerShape;
  if (maxPerShape !== undefined && Number.isFinite(maxPerShape)) {
    out.tabMaxPerShape = Math.max(0, Math.floor(maxPerShape));
  }
  setPercent(out, 'tabCutPowerPercent', patch.tabCutPowerPercent);
}

function setPowerMode(out: Record<string, unknown>, patch: ObjectOperationOverride): void {
  // Cut Settings represents Auto as an explicit undefined patch. Persist that
  // choice separately from an omitted field, which leaves inheritance intact.
  if (
    Object.hasOwn(patch, 'powerMode') &&
    (patch.powerMode === undefined ||
      patch.powerMode === 'auto' ||
      patch.powerMode === 'constant' ||
      patch.powerMode === 'dynamic')
  )
    out.powerMode = patch.powerMode ?? 'auto';
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

function setMinimumNumber(
  out: Record<string, unknown>,
  key: string,
  value: number | undefined,
  minimum: number,
): void {
  if (value !== undefined && Number.isFinite(value)) out[key] = Math.max(minimum, value);
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
