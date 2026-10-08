import type { Project } from '../scene/project';
import type { Layer } from '../scene/layer';
import type { SceneObject } from '../scene/scene-object';
import type { OutputScope } from '../scene/output-scope';
import { pathUsesOperation, sceneObjectUsesOperation } from '../scene/operation-binding';
import {
  hash,
  geometryStamp,
  linkedReliefGeometryStamps,
  cuttingSettings,
  usedTools,
  executionDevice,
} from './cnc-preparation-stamps';
export type CncOperationInputs = {
  readonly id: string;
  readonly name: string;
  readonly output: boolean;
  readonly boundaries: string;
  readonly bindings: string;
  readonly tools: string;
  readonly settings: string;
};
export type CncPreparationInputs = {
  readonly operations: readonly CncOperationInputs[];
  readonly stock: string;
  readonly post: string;
  readonly review: string;
  readonly signature: string;
};
export type CncDependencyStatus = {
  readonly operationId: string;
  readonly name: string;
  readonly status: 'ready' | 'dirty' | 'not-prepared' | 'disabled';
  readonly reasons: readonly string[];
};
const snapshots = new WeakMap<Project, Map<string, CncPreparationInputs>>();
/** Describe actual machining inputs; evidence only, never a second executable cache. */
export function cncPreparationInputs(project: Project, scope?: OutputScope): CncPreparationInputs {
  const effectiveScope = scope ?? project.jobSetup.outputScope,
    scopeKey = JSON.stringify(effectiveScope);
  const cached = snapshots.get(project)?.get(scopeKey);
  if (cached !== undefined) return cached;
  const selected = effectiveScope.cutSelectedGraphics
    ? new Set(effectiveScope.selectedObjectIds)
    : null;
  const objects = project.scene.objects.filter((o) => selected === null || selected.has(o.id));
  const objectsById = new Map(project.scene.objects.map((object) => [object.id, object]));
  const operations = project.scene.layers.map((layer) =>
    operationInputs(project, layer, objects, objectsById),
  );
  const global = globalInputs(project, effectiveScope);
  const signature = hash({
    operations: operations.map(({ name: _name, ...operation }) => operation),
    ...global,
  });
  const result = { operations, ...global, signature },
    byScope = snapshots.get(project) ?? new Map<string, CncPreparationInputs>();
  byScope.set(scopeKey, result);
  snapshots.set(project, byScope);
  return result;
}
function operationInputs(
  project: Project,
  layer: Layer,
  objects: readonly SceneObject[],
  objectsById: ReadonlyMap<string, SceneObject>,
): CncOperationInputs {
  const sources = objects.filter((o) => sceneObjectUsesOperation(o, layer));
  const target = project.scene.objects.find(
    (o) => o.id === layer.cnc?.reliefProjection?.reliefObjectId,
  );
  const machine = project.machine;
  return {
    id: layer.id,
    name: layer.name,
    output: layer.output && sources.length > 0,
    boundaries: hash(
      [...sources, ...(target === undefined ? [] : [target])].map((object) => [
        geometryStamp(object, layer),
        linkedReliefGeometryStamps(object, objectsById),
      ]),
    ),
    bindings: hash(sources.map((o) => sourceBindings(o, layer))),
    settings: hash(cuttingSettings(layer)),
    tools: hash(machine?.kind === 'cnc' ? usedTools(layer, machine.tools, machine.toolId) : []),
  };
}
function sourceBindings(object: SceneObject, layer: Layer): unknown {
  return {
    id: object.id,
    operationIds: object.operationIds,
    pathBindings:
      'paths' in object
        ? object.paths
            .filter((p) => pathUsesOperation(object, p, layer))
            .map((p) => p.operationIds ?? p.color)
        : undefined,
    overrides: object.operationOverride,
  };
}
function globalInputs(
  project: Project,
  scope: OutputScope,
): Omit<CncPreparationInputs, 'operations' | 'signature'> {
  const machine = project.machine,
    cnc = machine?.kind === 'cnc' ? machine : undefined;
  return {
    stock: hash(cnc?.stock ?? null),
    post: hash({
      device: executionDevice(project),
      side: project.cncSetup?.twoSided,
      params: cnc?.params ?? null,
      tiling: cnc?.tiling ?? null,
      placement: project.jobSetup.placement,
      scope,
      operationOrder: project.scene.layers.map((l) => l.id),
      artworkOrder: project.scene.artworkOrder,
      optimization: project.optimization,
      variables: project.variables,
    }),
    review: reviewStamp(project),
  };
}
export function cncDependencyStatuses(
  current: CncPreparationInputs,
  prepared?: CncPreparationInputs,
): readonly CncDependencyStatus[] {
  return current.operations.map((operation) => dependencyStatus(current, operation, prepared));
}
function dependencyStatus(
  current: CncPreparationInputs,
  operation: CncOperationInputs,
  prepared?: CncPreparationInputs,
): CncDependencyStatus {
  const base = { operationId: operation.id, name: operation.name };
  if (!operation.output)
    return { ...base, status: 'disabled', reasons: ['No enabled output for this scope'] };
  if (prepared === undefined)
    return {
      ...base,
      status: 'not-prepared',
      reasons: ['No preparation in this document session'],
    };
  const previous = prepared.operations.find((o) => o.id === operation.id);
  const reasons = operationReasons(operation, previous);
  const global = [
    [current.stock !== prepared.stock, 'Stock changed'],
    [current.post !== prepared.post, 'Machine, output placement, scope or order changed'],
    [current.review !== prepared.review, 'Fixture or tool assembly review changed'],
  ] as const;
  for (const [changed, reason] of global) if (changed) reasons.push(reason);
  return { ...base, status: reasons.length === 0 ? 'ready' : 'dirty', reasons };
}
function operationReasons(
  current: CncOperationInputs,
  previous: CncOperationInputs | undefined,
): string[] {
  if (previous === undefined || !previous.output) return ['Operation or output scope changed'];
  const differences = [
    ['boundaries', 'Source boundary, placement or relief field changed'],
    ['bindings', 'Artwork binding or per-artwork settings changed'],
    ['tools', 'Cutter changed'],
    ['settings', 'Cutting parameters changed'],
  ] as const;
  return differences.filter(([key]) => current[key] !== previous[key]).map(([, reason]) => reason);
}

function reviewStamp(project: Project): string {
  const cnc = project.machine?.kind === 'cnc' ? project.machine : undefined;
  return hash({
    fixtures: project.cncSetup?.fixtures,
    assemblies:
      cnc?.tools.map((t) => ({
        id: t.id,
        fluteLengthMm: t.fluteLengthMm,
        shankDiameterMm: t.shankDiameterMm,
        stickoutMm: t.stickoutMm,
        holderSegments: t.holderSegments,
      })) ?? [],
  });
}
