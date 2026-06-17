import {
  captureMaterialRecipe,
  MATERIAL_RECIPE_FIELDS,
  materialRecipePatch,
  type MaterialRecipe,
} from '../../core/material-library';
import { updateLayer, type Layer, type Project, type SceneObject } from '../../core/scene';
import type { MaterialLibraryDocument, MaterialPreset } from '../../io/material-library';
import { pushUndo, type StateSlice } from './scene-mutations';

export const MATERIAL_LIBRARY_STATE_DEFAULTS = {
  materialLibrary: null,
  materialLibraryDirty: false,
} as const;

export type MaterialLibraryState = {
  readonly materialLibrary: MaterialLibraryDocument | null;
  readonly materialLibraryDirty: boolean;
};

export type CreateMaterialPresetInput = Omit<MaterialPreset, 'recipe'>;

export type MaterialLibraryActions = {
  readonly setMaterialLibrary: (library: MaterialLibraryDocument | null) => void;
  readonly markMaterialLibrarySaved: () => void;
  readonly createMaterialPresetFromLayer: (
    layerId: string,
    input: CreateMaterialPresetInput,
  ) => MaterialPreset | null;
  readonly assignMaterialPresetToLayer: (layerId: string, presetId: string) => boolean;
};

export function currentMaterialLibraryState(state: MaterialLibraryState): MaterialLibraryState {
  return {
    materialLibrary: state.materialLibrary,
    materialLibraryDirty: state.materialLibraryDirty,
  };
}

type MaterialLibraryActionState = StateSlice &
  MaterialLibraryState & {
    readonly selectedObjectId: string | null;
  };

type ProjectMutation = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: [];
  readonly dirty: true;
};

type EmptyMutation = Record<string, never>;

type MaterialLibrarySet = (
  fn: (
    state: MaterialLibraryActionState,
  ) => Partial<MaterialLibraryState> | ProjectMutation | EmptyMutation,
) => void;

export function materialLibraryActions(set: MaterialLibrarySet): MaterialLibraryActions {
  return {
    setMaterialLibrary: (library) =>
      set(() => ({ materialLibrary: library, materialLibraryDirty: false })),
    markMaterialLibrarySaved: () => set(() => ({ materialLibraryDirty: false })),
    createMaterialPresetFromLayer: (layerId, input) => {
      let created: MaterialPreset | null = null;
      set((state) => {
        if (state.materialLibrary === null) return {};
        const calibrated = calibratedPresetFromSelection(state);
        const target =
          calibrated?.layer ?? state.project.scene.layers.find((layer) => layer.id === layerId);
        if (target === undefined) return {};
        if (state.materialLibrary.entries.some((entry) => entry.id === input.id.trim())) return {};

        const preset = createPreset(
          calibrated === null ? input : enrichCalibratedInput(input, calibrated, state.project),
          calibrated?.recipe ?? captureMaterialRecipe(target),
        );
        if (preset === null) return {};

        created = preset;
        return {
          materialLibrary: {
            ...state.materialLibrary,
            entries: [...state.materialLibrary.entries, preset],
          },
          materialLibraryDirty: true,
        };
      });
      return created;
    },
    assignMaterialPresetToLayer: (layerId, presetId) => {
      let assigned = false;
      set((state) => {
        if (state.materialLibrary === null) return {};
        const preset = state.materialLibrary.entries.find((entry) => entry.id === presetId);
        if (preset === undefined) return {};
        const target = state.project.scene.layers.find((layer) => layer.id === layerId);
        if (target === undefined) return {};
        if (recipeMatchesLayer(target, preset.recipe)) return {};

        assigned = true;
        return {
          project: {
            ...state.project,
            scene: updateLayer(state.project.scene, layerId, materialRecipePatch(preset.recipe)),
          },
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      });
      return assigned;
    },
  };
}

function createPreset(
  input: CreateMaterialPresetInput,
  recipe: MaterialRecipe,
): MaterialPreset | null {
  const strings = normalizeStrings(input);
  if (strings === null) return null;

  const label = normalizeThicknessLabel(input);
  if (label === null) return null;

  return {
    id: strings.id,
    materialName: strings.materialName,
    ...optionalString(input.material, 'material'),
    ...label,
    ...optionalString(input.operation, 'operation'),
    ...optionalString(input.profileId, 'profileId'),
    ...optionalString(input.machineFamily, 'machineFamily'),
    ...optionalString(input.laserModel, 'laserModel'),
    ...optionalNumber(input.opticalPowerW, 'opticalPowerW'),
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    description: strings.description,
    recipe: materialRecipePatch(recipe),
    revision: strings.revision,
  };
}

type CalibratedPreset = {
  readonly layer: Layer;
  readonly recipe: MaterialRecipe;
  readonly operation: NonNullable<MaterialPreset['operation']>;
  readonly note: string;
};

function calibratedPresetFromSelection(state: MaterialLibraryActionState): CalibratedPreset | null {
  const selected = selectedObject(state);
  if (selected?.kind !== 'imported-svg') return null;
  if (selected.source !== 'material-test-grid' && selected.source !== 'interval-test-grid') {
    return null;
  }
  const color = selected.paths[0]?.color;
  if (color === undefined) return null;
  const layer = state.project.scene.layers.find(
    (candidate) => candidate.id === color || candidate.color === color,
  );
  if (layer === undefined) return null;
  const base = captureMaterialRecipe(layer);
  if (selected.source === 'material-test-grid') {
    const power = clampPower((layer.power * (selected.powerScale ?? 100)) / 100);
    return {
      layer,
      recipe: { ...base, power, minPower: Math.min(base.minPower, power) },
      operation: 'material-test',
      note: `Calibrated from Material Test swatch ${selected.id}.`,
    };
  }
  return {
    layer,
    recipe: base,
    operation: 'interval-test',
    note: `Calibrated from Interval Test swatch ${selected.id}.`,
  };
}

function selectedObject(state: MaterialLibraryActionState): SceneObject | null {
  if (state.selectedObjectId === null) return null;
  return state.project.scene.objects.find((object) => object.id === state.selectedObjectId) ?? null;
}

function enrichCalibratedInput(
  input: CreateMaterialPresetInput,
  calibrated: CalibratedPreset,
  project: Project,
): CreateMaterialPresetInput {
  const profileId = calibratedProfileId(input, project);
  const machineFamily = calibratedMachineFamily(input, project, profileId);
  return {
    ...input,
    material: input.material ?? input.materialName,
    operation: input.operation ?? calibrated.operation,
    ...(profileId !== undefined ? { profileId } : {}),
    ...(machineFamily !== undefined ? { machineFamily } : {}),
    laserModel: calibratedLaserModel(input, project),
    ...optionalNumber(calibratedOpticalPower(input, project), 'opticalPowerW'),
    confidence: 'calibrated',
    description: `${input.description.trim()} ${calibrated.note}`,
  };
}

function calibratedProfileId(
  input: CreateMaterialPresetInput,
  project: Project,
): string | undefined {
  return input.profileId ?? project.device.profileId;
}

function calibratedMachineFamily(
  input: CreateMaterialPresetInput,
  project: Project,
  profileId: string | undefined,
): string | undefined {
  return input.machineFamily ?? project.device.machineFamily ?? profileId;
}

function calibratedLaserModel(input: CreateMaterialPresetInput, project: Project): string {
  return (
    input.laserModel ??
    project.device.laserSubProfile?.model ??
    project.device.model ??
    project.device.name
  );
}

function calibratedOpticalPower(
  input: CreateMaterialPresetInput,
  project: Project,
): number | undefined {
  return input.opticalPowerW ?? project.device.laserSubProfile?.opticalPowerW;
}

function normalizeStrings(input: CreateMaterialPresetInput): {
  readonly id: string;
  readonly materialName: string;
  readonly description: string;
  readonly revision: string;
} | null {
  const id = input.id.trim();
  const materialName = input.materialName.trim();
  const description = input.description.trim();
  const revision = input.revision.trim();

  if (
    id.length === 0 ||
    materialName.length === 0 ||
    description.length === 0 ||
    revision.length === 0
  ) {
    return null;
  }
  return { id, materialName, description, revision };
}

function normalizeThicknessLabel(
  input: CreateMaterialPresetInput,
): { readonly thicknessMm: number } | { readonly title: string } | null {
  const hasThickness = input.thicknessMm !== undefined;
  const normalizedTitle = input.title?.trim();
  const hasTitle = normalizedTitle !== undefined;

  if (hasTitle && normalizedTitle.length === 0) return null;
  if (hasThickness === hasTitle) return null;

  if (hasThickness) {
    const thicknessMm = input.thicknessMm;
    if (typeof thicknessMm !== 'number' || !Number.isFinite(thicknessMm) || thicknessMm <= 0) {
      return null;
    }
    return { thicknessMm };
  }

  if (normalizedTitle === undefined) return null;
  return { title: normalizedTitle };
}

function recipeMatchesLayer(layer: Layer, recipe: MaterialRecipe): boolean {
  const patch = materialRecipePatch(recipe);
  return MATERIAL_RECIPE_FIELDS.every((field) => layer[field] === patch[field]);
}

function optionalString(value: string | undefined, field: string): Record<string, string> {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? {} : { [field]: trimmed };
}

function optionalNumber(value: number | undefined, field: string): Record<string, number> {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? { [field]: value } : {};
}

function clampPower(value: number): number {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}
