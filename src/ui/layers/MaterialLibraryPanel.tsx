import { useState } from 'react';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import {
  NEOTRONICS_4040_MAX_LT4LDS_V2_PRESETS,
  materialPresetWarnings,
  type MaterialRecipeOperation,
  type StarterMaterialPreset,
} from '../../core/material-library';
import type { Layer } from '../../core/scene';
import {
  createMaterialLibraryDeviceHint,
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
  type MaterialPreset,
} from '../../io/material-library';
import { Button } from '../kit';
import { useStore } from '../state';
import { SavedLibrariesButton } from '../material-library/SavedLibrariesButton';
import { MaterialPresetWizardLauncher } from '../material-library/wizard';
import { MaterialLibraryRecipeControls } from './MaterialLibraryRecipeControls';
import {
  materialLibraryPresetOptions,
  type MaterialLibraryPresetOption,
} from './material-library-preset-options';
import {
  buttonRowStyle,
  fieldStyle,
  headingStyle,
  hintStyle,
  labelStyle,
  libraryNameStyle,
  sectionStyle,
  statusStyle,
} from './material-library-panel-styles';

export function MaterialLibraryPanel(): JSX.Element {
  const library = useStore((state) => state.materialLibrary);
  return library === null ? (
    <EmptyMaterialLibraryPanel />
  ) : (
    <LoadedMaterialLibraryPanel library={library} />
  );
}

function EmptyMaterialLibraryPanel(): JSX.Element {
  const device = useStore((state) => state.project.device);
  const createLibrary = useStore((state) => state.createLibrary);
  const setMaterialLibrary = useStore((state) => state.setMaterialLibrary);
  return (
    <section aria-label="Material Library" style={sectionStyle}>
      <Header />
      <p style={hintStyle}>
        No material library yet. Create one, or open one from Saved Libraries.
      </p>
      <div style={buttonRowStyle}>
        <Button
          aria-label="Create new material library"
          title="Create a new, empty material library for the current device profile."
          onClick={() => createLibrary(`${device.name} Library`)}
        >
          New library
        </Button>
        <Button
          aria-label="Create Neotronics starter material library"
          title="Create a starter library for the Neotronics 4040 Max / LT-4LDS-V2 20W diode profile. These are researched starting points, not guaranteed burn settings."
          onClick={() => setMaterialLibrary(createNeotronicsStarterLibrary())}
        >
          Neotronics Starters
        </Button>
      </div>
    </section>
  );
}

function LoadedMaterialLibraryPanel(props: {
  readonly library: MaterialLibraryDocument;
}): JSX.Element {
  const project = useStore((state) => state.project);
  const layers = useStore((state) => state.project.scene.layers);
  const assignMaterialPresetToLayer = useStore((state) => state.assignMaterialPresetToLayer);
  const deleteMaterialPreset = useStore((state) => state.deleteMaterialPreset);
  const [targetLayerId, setTargetLayerId] = useState('');
  const [presetId, setPresetId] = useState('');
  const [status, setStatus] = useState('');
  const presetOptions = materialLibraryPresetOptions(project.device, props.library.entries);
  const activeLayerId = activeId(
    targetLayerId,
    layers.map((layer) => layer.id),
  );
  const activePresetId = activeId(
    presetId,
    presetOptions.map((option) => option.preset.id),
  );
  const activePresetOption =
    presetOptions.find((option) => option.preset.id === activePresetId) ?? null;
  return (
    <section aria-label="Material Library" style={sectionStyle}>
      <Header />
      <p style={libraryNameStyle}>{props.library.name}</p>
      <MaterialLibrarySelectors
        layers={layers}
        presetOptions={presetOptions}
        activeLayerId={activeLayerId}
        activePresetId={activePresetId}
        onLayerChange={setTargetLayerId}
        onPresetChange={setPresetId}
      />
      <MaterialPresetWizardLauncher
        selectedPreset={activePresetOption?.preset ?? null}
        onSaved={(id) => setPresetId(id)}
      />
      <MaterialLibraryRecipeControls
        activeLayerId={activeLayerId}
        activePresetId={activePresetId}
        activePresetOption={activePresetOption}
        onAssign={() => assignMaterialPresetToLayer(activeLayerId, activePresetId)}
        onDelete={() => deleteMaterialPreset(activePresetId)}
        onStatus={setStatus}
      />
      {status !== '' ? <p style={statusStyle}>{status}</p> : null}
    </section>
  );
}

function MaterialLibrarySelectors(props: {
  readonly layers: ReadonlyArray<Layer>;
  readonly presetOptions: ReadonlyArray<MaterialLibraryPresetOption>;
  readonly activeLayerId: string;
  readonly activePresetId: string;
  readonly onLayerChange: (id: string) => void;
  readonly onPresetChange: (id: string) => void;
}): JSX.Element {
  const activeLayer = props.layers.find((layer) => layer.id === props.activeLayerId) ?? null;
  return (
    <>
      <label style={fieldStyle}>
        <span style={labelStyle}>Layer</span>
        <span style={layerControlStyle}>
          {/* Swatch background is scene data (the layer color), inline per ADR-047. */}
          {activeLayer === null ? null : (
            <span style={{ ...swatchStyle, background: activeLayer.color }} />
          )}
          <select
            aria-label="Material library target layer"
            value={props.activeLayerId}
            disabled={props.layers.length === 0}
            title="Choose which cut layer receives the selected material preset."
            onChange={(event) => props.onLayerChange(event.currentTarget.value)}
          >
            {props.layers.length === 0 ? <option value="">No layers</option> : null}
            {props.layers.map((layer, index) => (
              <option key={layer.id} value={layer.id}>
                {`Layer ${index + 1} (${layer.color})`}
              </option>
            ))}
          </select>
        </span>
      </label>
      <label style={fieldStyle}>
        <span style={labelStyle}>Preset</span>
        <select
          aria-label="Material library preset"
          value={props.activePresetId}
          disabled={props.presetOptions.length === 0}
          title="Choose the saved material preset to apply."
          onChange={(event) => props.onPresetChange(event.currentTarget.value)}
        >
          {props.presetOptions.length === 0 ? <option value="">No presets</option> : null}
          {props.presetOptions.map((option) => (
            <option key={option.preset.id} value={option.preset.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function Header(): JSX.Element {
  return (
    <div style={headerRowStyle}>
      <h2 style={headingStyle}>Material Library</h2>
      <SavedLibrariesButton />
    </div>
  );
}

function createNeotronicsStarterLibrary(): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: 'laserforge-neotronics-4040-max-lt4lds-v2',
    name: 'Neotronics 4040 Max Starter Library',
    deviceHint: createMaterialLibraryDeviceHint(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE),
    entries: NEOTRONICS_4040_MAX_LT4LDS_V2_PRESETS.map(toMaterialPreset),
  };
}

function toMaterialPreset(preset: StarterMaterialPreset): MaterialPreset {
  const warnings = materialPresetWarnings(preset);
  const warningText = warnings.length === 0 ? '' : ` Warnings: ${warnings.join(' ')}`;
  const unsupportedText = preset.unsupported === true ? ' Unsupported on this diode profile.' : '';
  return {
    id: preset.id,
    materialName: preset.materialName,
    material: preset.materialName,
    ...(preset.thicknessMm !== undefined ? { thicknessMm: preset.thicknessMm } : {}),
    ...(preset.title !== undefined ? { title: preset.title } : {}),
    ...starterPresetMetadata(preset, warnings),
    description: `${preset.description}${unsupportedText}${warningText}`,
    recipe: preset.recipe,
    revision: preset.revision,
  };
}

function starterPresetMetadata(
  preset: StarterMaterialPreset,
  warnings: ReadonlyArray<string>,
): Pick<
  MaterialPreset,
  | 'operation'
  | 'profileId'
  | 'machineFamily'
  | 'laserModel'
  | 'opticalPowerW'
  | 'confidence'
  | 'warning'
  | 'calibrationProvenance'
> {
  const profile = NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE;
  return {
    operation: starterPresetOperation(preset),
    ...(profile.profileId !== undefined ? { profileId: profile.profileId } : {}),
    ...(profile.machineFamily !== undefined ? { machineFamily: profile.machineFamily } : {}),
    ...(profile.laserSubProfile?.model !== undefined
      ? { laserModel: profile.laserSubProfile.model }
      : {}),
    ...(profile.laserSubProfile?.opticalPowerW !== undefined
      ? { opticalPowerW: profile.laserSubProfile.opticalPowerW }
      : {}),
    confidence: preset.unsupported === true ? 'unsupported' : 'starter',
    ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
    calibrationProvenance: preset.revision,
  };
}

function starterPresetOperation(preset: StarterMaterialPreset): MaterialRecipeOperation {
  const text = `${preset.id} ${preset.description} ${preset.title ?? ''}`.toLowerCase();
  if (text.includes('cut')) return 'cut';
  if (preset.recipe.mode === 'image') return 'engrave';
  return 'engrave';
}

function activeId(candidate: string, ids: ReadonlyArray<string>): string {
  if (candidate !== '' && ids.includes(candidate)) return candidate;
  return ids[0] ?? '';
}

const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};
const layerControlStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 1,
};
const swatchStyle: React.CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: 3,
  border: '1px solid var(--lf-border-strong)',
  flexShrink: 0,
};
