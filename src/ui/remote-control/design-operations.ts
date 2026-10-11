import type { Layer } from '../../core/scene';
import { operationProFeature } from '../licensing/pro-operation-policy';
import { proFeaturesUnlocked } from '../licensing/edition';
import type { AppState } from '../state/store';
import { historyProjection } from './authoring-projections';
import { RemoteFault } from './fault';
import { publicIdentifier } from './projections';
import { editableArtwork, expandedArtworkGroupIds } from './transforms';
import type { RemoteOperationPatchFull } from './design-validation';
import type { RemoteAppStore } from './types';

// A remote client that names no colour gets the first of these distinct layer colours not yet
// in use. The desktop's Add layer control asks the user instead.
/* eslint-disable no-restricted-syntax -- scene DATA: layer colour keys (what the machine cuts by), not chrome (ADR-047). */
const OPERATION_COLORS = [
  '#000000',
  '#0000ff',
  '#ff0000',
  '#00a000',
  '#ff8000',
  '#8000ff',
  '#00a0a0',
  '#a0a000',
  '#ff00ff',
  '#804000',
  '#008080',
  '#404040',
];
/* eslint-enable no-restricted-syntax */

export function operationLayer(state: AppState, operationId: string): Layer {
  if (!publicIdentifier(operationId)) throw new RemoteFault('unsupported_operation');
  const layer = state.project.scene.layers.find((candidate) => candidate.id === operationId);
  if (layer === undefined) throw new RemoteFault('not_found');
  return layer;
}

function receipt(store: RemoteAppStore, extra: Record<string, unknown>) {
  return { ...extra, history: historyProjection(store.getState()) };
}

export function createOperation(
  store: RemoteAppStore,
  args: {
    readonly color?: string | undefined;
    readonly mode?: Layer['mode'] | undefined;
    readonly name?: string | undefined;
  },
): Record<string, unknown> {
  const state = store.getState();
  const used = new Set(state.project.scene.layers.map((layer) => layer.color.toLowerCase()));
  const color = args.color ?? OPERATION_COLORS.find((candidate) => !used.has(candidate));
  if (color === undefined || used.has(color)) throw new RemoteFault('unsupported_operation');
  const before = new Set(state.project.scene.layers.map((layer) => layer.id));
  inOneUndoStep(store, () => {
    store.getState().createManualLayer(color);
    const created = store.getState().project.scene.layers.find((layer) => !before.has(layer.id));
    if (created === undefined) throw new RemoteFault('failed');
    if (args.mode !== undefined && store.getState().project.machine?.kind !== 'cnc')
      store.getState().setLayerParam(created.id, { mode: args.mode });
    if (args.name !== undefined) store.getState().renameOperation(created.id, args.name);
  });
  const created = store.getState().project.scene.layers.find((layer) => !before.has(layer.id));
  if (created === undefined || !publicIdentifier(created.id)) throw new RemoteFault('failed');
  return receipt(store, { operationId: created.id, changedOperationIds: [created.id] });
}

export function assignArtworkToOperation(
  store: RemoteAppStore,
  args: { readonly artworkIds: readonly string[]; readonly operationId: string },
): Record<string, unknown> {
  const state = store.getState();
  const layer = operationLayer(state, args.operationId);
  const ids = expandedArtworkGroupIds(state, args.artworkIds);
  editableArtwork(state, ids);
  if (!proFeaturesUnlocked() && operationProFeature(layer) !== null)
    throw new RemoteFault('needs_pro');
  store.getState().useOperationForObjects(ids, layer.id);
  return receipt(store, { operationId: layer.id, changedArtworkIds: ids });
}

export function reorderOperation(
  store: RemoteAppStore,
  args: { readonly operationId: string; readonly direction: 'up' | 'down' },
): Record<string, unknown> {
  const layer = operationLayer(store.getState(), args.operationId);
  store.getState().moveLayer(layer.id, args.direction);
  return receipt(store, { operationId: layer.id, changedOperationIds: [layer.id] });
}

export function deleteOperation(
  store: RemoteAppStore,
  args: { readonly operationId: string },
): Record<string, unknown> {
  const state = store.getState();
  const layer = operationLayer(state, args.operationId);
  if (state.project.scene.layers.length <= 1) throw new RemoteFault('unsupported_operation');
  const before = new Set(state.project.scene.objects.map((object) => object.id));
  store.getState().deleteLayerAndObjects(layer.id);
  const after = new Set(store.getState().project.scene.objects.map((object) => object.id));
  const removed = [...before].filter((id) => !after.has(id) && publicIdentifier(id)).slice(0, 200);
  return receipt(store, { operationId: layer.id, changedArtworkIds: removed });
}

export function applyMaterialRecipe(
  store: RemoteAppStore,
  args: { readonly operationId: string; readonly recipeId: string },
): Record<string, unknown> {
  const state = store.getState();
  const layer = operationLayer(state, args.operationId);
  const recipe = state.materialLibrary?.entries.find((entry) => entry.id === args.recipeId);
  if (recipe === undefined || !publicIdentifier(recipe.id)) throw new RemoteFault('not_found');
  const changed = store.getState().assignMaterialPresetToLayer(layer.id, recipe.id);
  return receipt(store, {
    operationId: layer.id,
    changedOperationIds: changed ? [layer.id] : [],
    ...(changed ? {} : { message: 'The operation already uses these recipe settings.' }),
  });
}

const LASER_FIELDS = {
  mode: 'mode',
  powerPercent: 'power',
  minPowerPercent: 'minPower',
  speedMmPerMin: 'speed',
  passes: 'passes',
  airAssist: 'airAssist',
  fillIntervalMm: 'hatchSpacingMm',
  fillAngleDeg: 'hatchAngleDeg',
  fillBidirectional: 'fillBidirectional',
  fillCrossHatch: 'fillCrossHatch',
  linesPerMm: 'linesPerMm',
  negativeImage: 'negativeImage',
} as const satisfies Partial<Record<keyof RemoteOperationPatchFull, keyof Layer>>;

const LASER_KEYS = Object.keys(LASER_FIELDS) as (keyof typeof LASER_FIELDS)[];

/** Laser fields belong to Laser workspaces and CNC settings to CNC workspaces. */
function assertPatchFitsMachine(cnc: boolean, patch: RemoteOperationPatchFull): void {
  const laser = LASER_KEYS.some((key) => patch[key] !== undefined);
  if ((cnc && laser) || (!cnc && patch.cnc !== undefined))
    throw new RemoteFault('unsupported_operation');
}

/** Changed ordinary fields as `setLayerParam` updates, plus their public names. */
function ordinaryUpdates(layer: Layer, patch: RemoteOperationPatchFull) {
  const updates: Record<string, unknown> = {};
  const changedFields: string[] = [];
  for (const key of LASER_KEYS) {
    const value = patch[key];
    if (value === undefined || layer[LASER_FIELDS[key]] === value) continue;
    updates[LASER_FIELDS[key]] = value;
    changedFields.push(key);
  }
  if (patch.enabled !== undefined && patch.enabled !== layer.output) {
    updates.output = patch.enabled;
    changedFields.push('enabled');
  }
  return { updates, changedFields };
}

/** Merged CNC settings; introducing a Pro strategy keeps the desktop Pro admission. */
function cncUpdate(layer: Layer, patch: RemoteOperationPatchFull): Layer['cnc'] | undefined {
  if (patch.cnc === undefined || layer.cnc === undefined) return undefined;
  const defined = Object.fromEntries(
    Object.entries(patch.cnc).filter(([, value]) => value !== undefined),
  ) as Partial<NonNullable<Layer['cnc']>>;
  const next: NonNullable<Layer['cnc']> = { ...layer.cnc, ...defined };
  const feature = operationProFeature({ cnc: next });
  if (feature !== null && feature !== operationProFeature(layer) && !proFeaturesUnlocked())
    throw new RemoteFault('needs_pro');
  return next;
}

/** Existing ordinary fields only. CNC strategy changes keep the desktop Pro admission. */
export function updateOperationFull(
  store: RemoteAppStore,
  operationId: string,
  patch: RemoteOperationPatchFull,
): Record<string, unknown> {
  const state = store.getState();
  const layer = operationLayer(state, operationId);
  assertPatchFitsMachine(state.project.machine?.kind === 'cnc', patch);
  const { updates, changedFields } = ordinaryUpdates(layer, patch);
  const cnc = cncUpdate(layer, patch);
  if (cnc !== undefined) {
    updates.cnc = cnc;
    changedFields.push('cnc');
  }
  const name = patch.name !== undefined && patch.name !== layer.name ? patch.name : null;
  if (name !== null) changedFields.push('name');
  if (changedFields.length > 0)
    inOneUndoStep(store, () => {
      if (Object.keys(updates).length > 0) store.getState().setLayerParam(layer.id, updates);
      if (name !== null) store.getState().renameOperation(layer.id, name);
    });
  return receipt(store, { operationId: layer.id, changedFields });
}

/** Runs several ordinary actions as one Undo step; nested calls join the outer step. */
export function inOneUndoStep(store: RemoteAppStore, run: () => void): void {
  const state = store.getState();
  if (state.pendingUndo !== null) {
    run();
    return;
  }
  state.beginInteraction();
  const ownedUndo = store.getState().pendingUndo;
  const ownsInteraction = () => {
    const current = store.getState();
    return (
      ownedUndo !== null &&
      ownedUndo.project === state.project &&
      current.pendingUndo === ownedUndo &&
      current.projectDocumentEpoch === state.projectDocumentEpoch
    );
  };
  const assertCurrent = () => {
    if (
      !ownsInteraction() ||
      store.getState().projectOpenRequestEpoch !== state.projectOpenRequestEpoch
    )
      throw new RemoteFault('stale_revision');
  };
  try {
    assertCurrent();
    run();
    assertCurrent();
  } catch (error) {
    if (ownsInteraction()) store.getState().cancelInteraction();
    throw error;
  }
  store.getState().endInteraction();
}
