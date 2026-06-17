import { useState } from 'react';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, type DeviceProfile } from '../../core/devices';
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
import {
  handleOpenMaterialLibrary,
  handleSaveMaterialLibrary,
} from '../app/material-library-file-actions';
import { usePlatform } from '../app/platform-context';
import { Button } from '../kit';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { CreatePresetForm } from './MaterialLibraryCreatePresetForm';
import {
  buttonRowStyle,
  fieldStyle,
  headingStyle,
  labelStyle,
  libraryHeaderStyle,
  libraryNameStyle,
  sectionStyle,
  statusStyle,
} from './material-library-panel-styles';

export function MaterialLibraryPanel(): JSX.Element {
  const library = useStore((state) => state.materialLibrary);
  const libraryDirty = useStore((state) => state.materialLibraryDirty);
  return library === null ? (
    <EmptyMaterialLibraryPanel />
  ) : (
    <LoadedMaterialLibraryPanel library={library} libraryDirty={libraryDirty} />
  );
}

function EmptyMaterialLibraryPanel(): JSX.Element {
  const platform = usePlatform();
  const device = useStore((state) => state.project.device);
  const setMaterialLibrary = useStore((state) => state.setMaterialLibrary);
  const pushToast = useToastStore((state) => state.pushToast);
  return (
    <section aria-label="Material Library" style={sectionStyle}>
      <Header />
      <div style={buttonRowStyle}>
        <Button
          aria-label="Create new material library"
          title="Create a new material library for the current device profile."
          onClick={() => setMaterialLibrary(createBlankLibrary(device))}
        >
          New Library
        </Button>
        <Button
          aria-label="Create Neotronics starter material library"
          title="Create a starter library for the Neotronics 4040 Max / LT-4LDS-V2 20W diode profile. These are researched starting points, not guaranteed burn settings."
          onClick={() => setMaterialLibrary(createNeotronicsStarterLibrary())}
        >
          Neotronics Starters
        </Button>
        <Button
          aria-label="Load material library"
          title="Load a saved LaserForge material library file."
          onClick={() => {
            void handleOpenMaterialLibrary({ platform, setMaterialLibrary, pushToast });
          }}
        >
          Load...
        </Button>
      </div>
    </section>
  );
}

function LoadedMaterialLibraryPanel(props: {
  readonly library: MaterialLibraryDocument;
  readonly libraryDirty: boolean;
}): JSX.Element {
  const platform = usePlatform();
  const layers = useStore((state) => state.project.scene.layers);
  const setMaterialLibrary = useStore((state) => state.setMaterialLibrary);
  const markMaterialLibrarySaved = useStore((state) => state.markMaterialLibrarySaved);
  const assignMaterialPresetToLayer = useStore((state) => state.assignMaterialPresetToLayer);
  const pushToast = useToastStore((state) => state.pushToast);
  const [targetLayerId, setTargetLayerId] = useState('');
  const [presetId, setPresetId] = useState('');
  const [status, setStatus] = useState('');
  const activeLayerId = activeId(
    targetLayerId,
    layers.map((layer) => layer.id),
  );
  const activePresetId = activeId(
    presetId,
    props.library.entries.map((entry) => entry.id),
  );
  const assignDisabled = activeLayerId === '' || activePresetId === '';
  return (
    <section aria-label="Material Library" style={sectionStyle}>
      <Header />
      <LibraryHeader
        library={props.library}
        libraryDirty={props.libraryDirty}
        onUnload={() => {
          setMaterialLibrary(null);
          setStatus('');
        }}
        onLoad={() => {
          setStatus('');
          void handleOpenMaterialLibrary({ platform, setMaterialLibrary, pushToast });
        }}
        onSave={() => {
          void handleSaveMaterialLibrary({
            platform,
            library: props.library,
            markMaterialLibrarySaved,
            pushToast,
          });
        }}
      />
      <MaterialLibrarySelectors
        layers={layers}
        library={props.library}
        activeLayerId={activeLayerId}
        activePresetId={activePresetId}
        onLayerChange={setTargetLayerId}
        onPresetChange={setPresetId}
      />
      <Button
        aria-label="Assign selected material preset"
        title="Apply the selected material preset to the selected layer."
        disabled={assignDisabled}
        onClick={() => {
          setStatus(
            assignMaterialPresetToLayer(activeLayerId, activePresetId)
              ? `Assigned to ${activeLayerId}.`
              : 'Preset was not assigned.',
          );
        }}
      >
        Assign
      </Button>
      <CreatePresetForm
        targetLayerId={activeLayerId}
        entryCount={props.library.entries.length}
        onCreated={(id) => {
          setPresetId(id);
          setStatus('Preset created.');
        }}
        onFailed={setStatus}
      />
      {status !== '' ? <p style={statusStyle}>{status}</p> : null}
    </section>
  );
}

function LibraryHeader(props: {
  readonly library: MaterialLibraryDocument;
  readonly libraryDirty: boolean;
  readonly onUnload: () => void;
  readonly onLoad: () => void;
  readonly onSave: () => void;
}): JSX.Element {
  return (
    <div style={libraryHeaderStyle}>
      <span style={libraryNameStyle}>
        {props.library.name}
        {props.libraryDirty ? ' *' : ''}
      </span>
      <div style={buttonRowStyle}>
        <Button
          aria-label="Load material library"
          title="Load a different material library file."
          onClick={props.onLoad}
        >
          Load...
        </Button>
        <Button
          aria-label="Save material library"
          title="Save the current material library to disk."
          onClick={props.onSave}
        >
          Save...
        </Button>
        <Button
          aria-label="Unload material library"
          title="Close the loaded material library without deleting the file."
          onClick={props.onUnload}
        >
          Unload
        </Button>
      </div>
    </div>
  );
}

function MaterialLibrarySelectors(props: {
  readonly layers: ReadonlyArray<Layer>;
  readonly library: MaterialLibraryDocument;
  readonly activeLayerId: string;
  readonly activePresetId: string;
  readonly onLayerChange: (id: string) => void;
  readonly onPresetChange: (id: string) => void;
}): JSX.Element {
  return (
    <>
      <label style={fieldStyle}>
        <span style={labelStyle}>Layer</span>
        <select
          aria-label="Material library target layer"
          value={props.activeLayerId}
          disabled={props.layers.length === 0}
          title="Choose which cut layer receives the selected material preset."
          onChange={(event) => props.onLayerChange(event.currentTarget.value)}
        >
          {props.layers.length === 0 ? <option value="">No layers</option> : null}
          {props.layers.map((layer) => (
            <option key={layer.id} value={layer.id}>
              {layer.color}
            </option>
          ))}
        </select>
      </label>
      <label style={fieldStyle}>
        <span style={labelStyle}>Preset</span>
        <select
          aria-label="Material library preset"
          value={props.activePresetId}
          disabled={props.library.entries.length === 0}
          title="Choose the saved material preset to apply."
          onChange={(event) => props.onPresetChange(event.currentTarget.value)}
        >
          {props.library.entries.length === 0 ? <option value="">No presets</option> : null}
          {props.library.entries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {presetLabel(entry.materialName, entry.thicknessMm, entry.title)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function Header(): JSX.Element {
  return <h2 style={headingStyle}>Material Library</h2>;
}

function createBlankLibrary(device: DeviceProfile): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: `laserforge-${slug(device.name)}`,
    name: `${device.name} Library`,
    deviceHint: createMaterialLibraryDeviceHint(device),
    entries: [],
  };
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

function presetLabel(
  materialName: string,
  thicknessMm: number | undefined,
  title: string | undefined,
): string {
  const label = thicknessMm !== undefined ? `${formatThickness(thicknessMm)} mm` : title;
  return `${materialName} - ${label ?? 'Preset'}`;
}

function formatThickness(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function slug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'library'
  );
}
