import {
  captureMaterialRecipe,
  MATERIAL_RECIPE_FIELDS,
  materialRecipePatch,
  rankMaterialRecipeCandidates,
  type MaterialRecipe,
} from '../../core/material-library';
import { updateLayer, type Layer, type Project } from '../../core/scene';
import type { MaterialLibraryDocument, MaterialPreset } from '../../io/material-library';
import {
  materialLibraryCalibrationFromSelection,
  type MaterialLibraryCalibrationContext,
} from './material-library-calibration';
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
  readonly updateMaterialPresetFromLayer: (layerId: string, presetId: string) => boolean;
  readonly deleteMaterialPreset: (presetId: string) => boolean;
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
        const calibrated = materialLibraryCalibrationFromSelection({
          project: state.project,
          selectedObjectId: state.selectedObjectId,
        });
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
        if (!canAssignPreset(state.project, preset)) return {};
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
    updateMaterialPresetFromLayer: (layerId, presetId) =>
      updateMaterialPresetFromLayer(set, layerId, presetId),
    deleteMaterialPreset: (presetId) => deleteMaterialPreset(set, presetId),
  };
}

function updateMaterialPresetFromLayer(
  set: MaterialLibrarySet,
  layerId: string,
  presetId: string,
): boolean {
  let updated = false;
  set((state) => {
    if (state.materialLibrary === null) return {};
    const target = state.project.scene.layers.find((layer) => layer.id === layerId);
    if (target === undefined) return {};
    const presetIndex = state.materialLibrary.entries.findIndex((entry) => entry.id === presetId);
    if (presetIndex < 0) return {};
    const preset = state.materialLibrary.entries[presetIndex];
    if (preset === undefined || recipeMatchesLayer(target, preset.recipe)) return {};

    updated = true;
    return {
      materialLibrary: {
        ...state.materialLibrary,
        entries: updatePresetRecipe(state.materialLibrary.entries, presetIndex, target),
      },
      materialLibraryDirty: true,
    };
  });
  return updated;
}

function updatePresetRecipe(
  entries: ReadonlyArray<MaterialPreset>,
  presetIndex: number,
  target: Layer,
): ReadonlyArray<MaterialPreset> {
  return entries.map((entry, index) =>
    index === presetIndex
      ? { ...entry, recipe: materialRecipePatch(captureMaterialRecipe(target)) }
      : entry,
  );
}

function deleteMaterialPreset(set: MaterialLibrarySet, presetId: string): boolean {
  let deleted = false;
  set((state) => {
    if (state.materialLibrary === null) return {};
    const entries = state.materialLibrary.entries.filter((entry) => entry.id !== presetId);
    if (entries.length === state.materialLibrary.entries.length) return {};

    deleted = true;
    return {
      materialLibrary: { ...state.materialLibrary, entries },
      materialLibraryDirty: true,
    };
  });
  return deleted;
}

function canAssignPreset(project: Project, preset: MaterialPreset): boolean {
  const [match] = rankMaterialRecipeCandidates(project.device, [preset]);
  return match !== undefined && match.confidence !== 'unsupported';
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
    ...optionalString(input.calibrationProvenance, 'calibrationProvenance'),
    description: strings.description,
    recipe: materialRecipePatch(recipe),
    revision: strings.revision,
  };
}

function enrichCalibratedInput(
  input: CreateMaterialPresetInput,
  calibrated: MaterialLibraryCalibrationContext,
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
    calibrationProvenance: calibrated.calibrationProvenance,
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
