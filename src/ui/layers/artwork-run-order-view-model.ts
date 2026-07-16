import { artworkRunUnits } from '../../core/artwork-run-units';
import { compileCncJob } from '../../core/cnc';
import { compileJob } from '../../core/job';
import {
  artworkOperationName,
  cutTypeLabel,
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  machineKindOf,
  transformedBBox,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';

export type ArtworkRunOrderRowModel = {
  readonly key: string;
  readonly objectIds: ReadonlyArray<string>;
  readonly position: number;
  readonly name: string;
  readonly kindLabel: string;
  readonly colors: ReadonlyArray<string>;
  readonly dimensions: string;
  readonly operationSummary: string;
  readonly settingsSummary: string;
  readonly effectiveSteps: ReadonlyArray<number>;
  readonly output: boolean;
  readonly shared: boolean;
};

export function artworkRunOrderRows(project: Project): ReadonlyArray<ArtworkRunOrderRowModel> {
  const objectById = new Map(project.scene.objects.map((object) => [object.id, object]));
  const layerById = new Map(project.scene.layers.map((layer) => [layer.id, layer]));
  const effectiveSteps = effectiveStepsByObject(project);
  return artworkRunUnits(project.scene).map((unit, index) => {
    const objects = unit.objectIds.flatMap((id) => {
      const object = objectById.get(id);
      return object === undefined ? [] : [object];
    });
    const layers = unit.operationIds.flatMap((id) => {
      const layer = layerById.get(id);
      return layer === undefined ? [] : [layer];
    });
    const first = objects[0];
    const name = layers[0]?.name ?? (first === undefined ? 'Artwork' : artworkOperationName(first));
    return {
      key: unit.key,
      objectIds: unit.objectIds,
      position: index + 1,
      name: objects.length > 1 ? `${name} + ${objects.length - 1} more` : name,
      kindLabel: objects.length > 1 ? 'Unified artwork' : objectKindLabel(first),
      colors: layers.map((layer) => layer.color),
      dimensions: combinedDimensions(objects),
      operationSummary: operationSummary(layers),
      settingsSummary: settingsSummary(project, layers),
      effectiveSteps: uniqueSorted(unit.objectIds.flatMap((id) => effectiveSteps.get(id) ?? [])),
      output: layers.some((layer) => layer.output),
      shared: objects.length > 1,
    };
  });
}

function effectiveStepsByObject(project: Project): ReadonlyMap<string, ReadonlyArray<number>> {
  const groups =
    project.machine?.kind === 'cnc'
      ? compileCncJob(project.scene, project.device, project.machine).groups
      : compileJob(project.scene, project.device).groups;
  const steps = new Map<string, number[]>();
  groups.forEach((group, index) => {
    if (group.sourceObjectId === undefined) return;
    const existing = steps.get(group.sourceObjectId) ?? [];
    existing.push(index + 1);
    steps.set(group.sourceObjectId, existing);
  });
  return steps;
}

function settingsSummary(project: Project, layers: ReadonlyArray<Layer>): string {
  if (layers.length === 0) return 'No operation assigned';
  if (machineKindOf(project.machine) === 'laser') {
    return layers
      .map(
        (layer) =>
          `${modeLabel(layer.mode)} · ${formatNumber(layer.power)}% · ${formatNumber(layer.speed)} mm/min · ${layer.passes}×`,
      )
      .join(' | ');
  }
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return 'CNC settings unavailable';
  return layers
    .map((layer) => {
      const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
      const tool = layerCncTool(machine, settings);
      return `${cutTypeLabel(settings.cutType)} · ${tool.name} · ${formatNumber(settings.depthMm)} mm · ${formatNumber(settings.feedMmPerMin)} mm/min`;
    })
    .join(' | ');
}

function operationSummary(layers: ReadonlyArray<Layer>): string {
  if (layers.length === 0) return 'No operation';
  return layers.map((layer) => layer.name).join(' + ');
}

function combinedDimensions(objects: ReadonlyArray<SceneObject>): string {
  if (objects.length === 0) return '0 × 0 mm';
  const boxes = objects.map(transformedBBox);
  const minX = Math.min(...boxes.map((box) => box.minX));
  const minY = Math.min(...boxes.map((box) => box.minY));
  const maxX = Math.max(...boxes.map((box) => box.maxX));
  const maxY = Math.max(...boxes.map((box) => box.maxY));
  return `${formatNumber(maxX - minX)} × ${formatNumber(maxY - minY)} mm`;
}

function objectKindLabel(object: SceneObject | undefined): string {
  if (object === undefined) return 'Artwork';
  switch (object.kind) {
    case 'imported-svg':
      return 'Vector artwork';
    case 'text':
      return 'Text';
    case 'traced-image':
      return 'Traced image';
    case 'raster-image':
      return 'Bitmap';
    case 'shape':
      return 'Shape';
    case 'relief':
      return '3D relief';
    default:
      return object satisfies never;
  }
}

function modeLabel(mode: Layer['mode']): string {
  if (mode === 'line') return 'Line';
  if (mode === 'fill') return 'Fill';
  return 'Image';
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function uniqueSorted(values: ReadonlyArray<number>): ReadonlyArray<number> {
  return [...new Set(values)].sort((left, right) => left - right);
}
