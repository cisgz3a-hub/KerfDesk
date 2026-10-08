import { operationIdsForObject, sceneLayerVisibility, type Layer } from '../../core/scene';
import { transformedBBox } from '../../core/scene/hit-test';
import type { AppState } from '../state/store';
import type { RemoteBounds } from './types';
import { finite, identifier } from './validation';
import { RemoteFault } from './fault';

const LIMIT = 200;
/** Labels are allowed; paths and accidentally pasted credentials are not remote metadata. */
export function safeLabel(value: string, fallback: string, max = 512): string {
  if (/(?:[a-z]:[\\/]|file:\/\/|https?:\/\/|\\\\|^\/|KD1\.|Bearer\s)/i.test(value)) return fallback;
  return value.slice(0, max);
}
export function publicIdentifier(value: unknown): value is string {
  return identifier(value) && safeLabel(value, '') === value;
}
export function remoteBounds(bounds: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}): RemoteBounds | undefined {
  const widthMm = bounds.maxX - bounds.minX;
  const heightMm = bounds.maxY - bounds.minY;
  if (
    !finite(bounds.minX, -100_000, 100_000) ||
    !finite(bounds.minY, -100_000, 100_000) ||
    !finite(widthMm, 0, 100_000) ||
    !finite(heightMm, 0, 100_000)
  )
    return undefined;
  return { xMm: bounds.minX, yMm: bounds.minY, widthMm, heightMm };
}
export function selectedIds(state: AppState): string[] {
  return [
    ...new Set([
      ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
      ...state.additionalSelectedIds,
    ]),
  ];
}
export function workspaceProjection(state: AppState, shareArtwork = false) {
  const { scene } = state.project;
  const mode = state.project.machine?.kind ?? 'laser';
  const visibility = sceneLayerVisibility.lookup(scene.layers);
  const artwork = scene.objects
    .filter((object) => publicIdentifier(object.id))
    .slice(0, LIMIT)
    .map((object) => {
      const bounds = remoteBounds(transformedBBox(object));
      const operationId = operationIdsForObject(object, scene.layers).find(publicIdentifier);
      const visible = sceneLayerVisibility.hasObject(object, visibility);
      return {
        id: object.id,
        type: object.kind,
        visible,
        // Target-level hint only; caller permission and revision are checked on every write.
        editable: visible && object.locked !== true,
        ...(bounds === undefined ? {} : { bounds }),
        ...(operationId === undefined ? {} : { operationId }),
      };
    });
  const operations = scene.layers
    .filter((layer) => publicIdentifier(layer.id))
    .slice(0, LIMIT)
    .map((layer) => ({
      id: layer.id,
      type: mode === 'laser' ? layer.mode : (layer.cnc?.cutType ?? 'cnc'),
      // Operation names have no source provenance: converted text can retain its
      // old wording here. Labels therefore share the explicit artwork opt-in.
      name: shareArtwork ? safeLabel(layer.name, 'Operation') : 'Operation',
      enabled: layer.output,
      ...(mode === 'laser' ? operationValues(layer) : {}),
    }));
  const allSelected = selectedIds(state).filter(publicIdentifier);
  return {
    mode,
    name: 'Current workspace',
    dirty: state.dirty,
    selection: allSelected.slice(0, LIMIT),
    artwork,
    operations,
    totalArtwork: scene.objects.length,
    totalOperations: scene.layers.length,
    truncated:
      artwork.length < scene.objects.length ||
      operations.length < scene.layers.length ||
      allSelected.length > LIMIT,
  };
}
export function operationValues(layer: Pick<Layer, 'power' | 'speed' | 'passes'>) {
  return {
    ...(finite(layer.power, 0, 100) ? { powerPercent: layer.power } : {}),
    ...(finite(layer.speed, Number.MIN_VALUE, 100_000) ? { speedMmPerMin: layer.speed } : {}),
    ...(finite(layer.passes, 1, 1000) && Number.isInteger(layer.passes)
      ? { passes: layer.passes }
      : {}),
  };
}
export function machineProjection(state: AppState): Record<string, unknown> {
  const device = state.project.device;
  if (!finite(device.bedWidth, 0, 100_000) || !finite(device.bedHeight, 0, 100_000))
    throw new RemoteFault('unavailable');
  const machine = state.project.machine;
  return {
    machine: {
      id: publicIdentifier(device.profileId) ? device.profileId : 'selected-machine',
      name: safeLabel(device.name, 'Selected machine'),
      mode: machine?.kind ?? 'laser',
      bedWidthMm: device.bedWidth,
      bedHeightMm: device.bedHeight,
      units: 'mm',
      ...(finite(device.maxFeed, Number.MIN_VALUE, 100_000)
        ? { maxFeedMmPerMin: device.maxFeed }
        : {}),
      ...(machine?.kind === 'cnc' ? cncLimits(machine.params) : {}),
    },
  };
}
function cncLimits(params: { safeZMm: number; spindleMaxRpm: number; maxFeedMmPerMin?: number }) {
  return {
    ...(finite(params.safeZMm, -100_000, 100_000) ? { safeZMm: params.safeZMm } : {}),
    ...(finite(params.spindleMaxRpm, 0, 1_000_000) ? { spindleMaxRpm: params.spindleMaxRpm } : {}),
    ...(finite(params.maxFeedMmPerMin, Number.MIN_VALUE, 100_000)
      ? { maxFeedMmPerMin: params.maxFeedMmPerMin }
      : {}),
  };
}
export function recipesProjection(state: AppState): Record<string, unknown> {
  const entries = state.materialLibrary?.entries ?? [];
  const recipes = entries
    .filter((entry) => publicIdentifier(entry.id))
    .slice(0, LIMIT)
    .map((entry) => ({
      id: entry.id,
      name: safeLabel(entry.title ?? entry.materialName, 'Material recipe'),
      materialName: safeLabel(entry.materialName, 'Material'),
      ...operationValues(entry.recipe),
    }));
  return { recipes, total: entries.length, truncated: recipes.length < entries.length };
}
