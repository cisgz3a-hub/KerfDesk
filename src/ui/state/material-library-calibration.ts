import { captureMaterialRecipe, type MaterialRecipe } from '../../core/material-library';
import type { Layer, Project, SceneObject } from '../../core/scene';
import type { MaterialPreset } from '../../io/material-library';

const MATERIAL_TEST_SOURCE = 'material-test-grid';
const INTERVAL_TEST_SOURCE = 'interval-test-grid';

export type MaterialLibraryCalibrationKind = 'material-test' | 'interval-test';

export type MaterialLibraryCalibrationContext = {
  readonly kind: MaterialLibraryCalibrationKind;
  readonly objectId: string;
  readonly layer: Layer;
  readonly recipe: MaterialRecipe;
  readonly operation: NonNullable<MaterialPreset['operation']>;
  readonly note: string;
  readonly calibrationProvenance: string;
};

/** Returns calibrated recipe context for the selected generated test swatch. */
export function materialLibraryCalibrationFromSelection(args: {
  readonly project: Project;
  readonly selectedObjectId: string | null;
}): MaterialLibraryCalibrationContext | null {
  const selected = selectedObject(args.project, args.selectedObjectId);
  if (selected?.kind !== 'imported-svg') return null;
  const kind = calibrationKind(selected.source);
  if (kind === null) return null;

  const color = selected.paths[0]?.color;
  if (color === undefined) return null;
  const layer = layerForColor(args.project, color);
  if (layer === undefined) return null;

  const base = captureMaterialRecipe(layer);
  if (kind === 'material-test') {
    const power = clampPower((layer.power * (selected.powerScale ?? 100)) / 100);
    return calibrationContext({
      kind,
      objectId: selected.id,
      layer,
      recipe: { ...base, power, minPower: Math.min(base.minPower, power) },
    });
  }

  return calibrationContext({ kind, objectId: selected.id, layer, recipe: base });
}

function selectedObject(project: Project, id: string | null): SceneObject | null {
  if (id === null) return null;
  return project.scene.objects.find((object) => object.id === id) ?? null;
}

function calibrationKind(source: string): MaterialLibraryCalibrationKind | null {
  if (source === MATERIAL_TEST_SOURCE) return 'material-test';
  if (source === INTERVAL_TEST_SOURCE) return 'interval-test';
  return null;
}

function layerForColor(project: Project, color: string): Layer | undefined {
  return project.scene.layers.find((layer) => layer.id === color || layer.color === color);
}

function calibrationContext(args: {
  readonly kind: MaterialLibraryCalibrationKind;
  readonly objectId: string;
  readonly layer: Layer;
  readonly recipe: MaterialRecipe;
}): MaterialLibraryCalibrationContext {
  const label = args.kind === 'material-test' ? 'Material Test' : 'Interval Test';
  return {
    ...args,
    operation: args.kind,
    calibrationProvenance: `${label} swatch ${args.objectId}`,
    note: `Calibrated from ${label} swatch ${args.objectId}.`,
  };
}

function clampPower(value: number): number {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}
