import type { Project } from '../scene/project';
import type { Layer } from '../scene/layer';
import type { HeightfieldReliefObject, SceneObject } from '../scene/scene-object';
import { pathUsesOperation } from '../scene/operation-binding';
import type { CncTool } from '../scene/cnc-tool';
import { sha256Hex } from '../relief/sha256';
import { reliefAuthoringLinkIds } from '../relief/relief-authoring-link-ids';
const objectGeometry = new WeakMap<SceneObject, Map<string, string>>();
export function geometryStamp(object: SceneObject, layer: Layer): string {
  const operationKey = JSON.stringify([layer.id, layer.bindingOperationId, layer.color]);
  const cached = objectGeometry.get(object)?.get(operationKey);
  if (cached !== undefined) return cached;
  const raw = { ...object } as Record<string, unknown>;
  if ('paths' in object)
    raw['paths'] = object.paths.filter((path) => pathUsesOperation(object, path, layer));
  const descriptive = new Set([
    'name',
    'source',
    'locked',
    'operationIds',
    'operationOverride',
    'libraryProvenance',
    'reliefAuthoring',
    'partGenerator',
    'constrainedSketch',
  ]);
  const filtered = Object.fromEntries(Object.entries(raw).filter(([key]) => !descriptive.has(key)));
  if (object.kind === 'relief' && object.reliefSource.kind === 'heightfield-v1') {
    const {
      samplesBase64: _samples,
      inclusionMask: _mask,
      provenance: _provenance,
      ...field
    } = object.reliefSource;
    filtered['reliefSource'] = field;
  }
  const stamp = hash(filtered);
  const byOperation = objectGeometry.get(object) ?? new Map<string, string>();
  byOperation.set(operationKey, stamp);
  objectGeometry.set(object, byOperation);
  return stamp;
}
const linkedSourceGeometry = new WeakMap<SceneObject, string>();
/** Live links remain machining dependencies even when a failed edit retains the previous field. */
export function linkedReliefGeometryStamps(
  object: SceneObject,
  objectsById: ReadonlyMap<string, SceneObject>,
): unknown {
  if (object.kind !== 'relief' || object.reliefSource.kind !== 'heightfield-v1') return [];
  const document = (object as HeightfieldReliefObject).reliefAuthoring;
  if (document === undefined) return [];
  return reliefAuthoringLinkIds(document).map((id) => {
    const source = objectsById.get(id);
    return [id, source === undefined ? 'missing' : fullLinkedSourceGeometryStamp(source)];
  });
}
function fullLinkedSourceGeometryStamp(object: SceneObject): string {
  const cached = linkedSourceGeometry.get(object);
  if (cached !== undefined) return cached;
  const stamp = hash({
    kind: object.kind,
    transform: object.transform,
    polylines: 'paths' in object ? object.paths.flatMap((path) => path.polylines) : null,
  });
  linkedSourceGeometry.set(object, stamp);
  return stamp;
}
export function cuttingSettings(layer: Layer): unknown {
  const settings = layer.cnc;
  if (settings === undefined) return null;
  const { cuttingPreset: _preset, feedSource: _source, ...actual } = settings;
  return actual;
}
export function usedTools(layer: Layer, tools: ReadonlyArray<CncTool>, defaultId: string): unknown {
  const cnc = layer.cnc;
  const ids = new Set([
    cnc?.toolId ?? defaultId,
    cnc?.vClearToolId,
    cnc?.pocketRoughToolId,
    cnc?.reliefFinishToolId,
    cnc?.reliefRestFinishToolId,
    ...Object.values(cnc?.stageRecipes ?? {}).map((recipe) => recipe.toolId),
  ]);
  if (!tools.some((tool) => tool.id === (cnc?.toolId ?? defaultId))) ids.add(defaultId);
  return tools
    .filter((tool) => ids.has(tool.id))
    .map((tool) => ({
      id: tool.id,
      kind: tool.kind,
      diameterMm: tool.diameterMm,
      tipDiameterMm: tool.tipDiameterMm,
      tipAngleDeg: tool.tipAngleDeg,
    }));
}
export function executionDevice(project: Project): unknown {
  const { name: _name, cameraProfile: _camera, ...device } = project.device;
  return device;
}
export function hash(value: unknown): string {
  return sha256Hex([new TextEncoder().encode(JSON.stringify(value))]);
}
