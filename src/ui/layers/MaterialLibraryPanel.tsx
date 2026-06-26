import { useState } from 'react';
import { starterLibraryEntryForProfileId } from '../../core/material-library';
import type { Layer } from '../../core/scene';
import type { MaterialLibraryDocument } from '../../io/material-library';
import {
  handleOpenMaterialLibrary,
  handleSaveMaterialLibrary,
} from '../app/material-library-file-actions';
import { usePlatform } from '../app/platform-context';
import { Button } from '../kit';
import { useStore } from '../state';
import { materialLibraryCalibrationFromSelection } from '../state/material-library-calibration';
import { useToastStore } from '../state/toast-store';
import { buildBlankLibrary, buildStarterLibrary } from './material-library-builders';
import { MaterialLibraryRecipeControls } from './MaterialLibraryRecipeControls';
import {
  materialLibraryPresetOptions,
  type MaterialLibraryPresetOption,
} from './material-library-preset-options';
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
  const starterEntry = starterLibraryEntryForProfileId(device.profileId);
  return (
    <section aria-label="Material Library" style={sectionStyle}>
      <Header />
      <div style={buttonRowStyle}>
        <Button
          aria-label="Create new material library"
          title="Create a new material library for the current device profile."
          onClick={() => setMaterialLibrary(buildBlankLibrary(device))}
        >
          New Library
        </Button>
        {starterEntry !== null ? (
          <Button
            aria-label="Create starter material library for the selected device"
            title={`Create a starter library for ${starterEntry.profile.name}. Researched starting points, not guaranteed burn settings.`}
            onClick={() =>
              setMaterialLibrary(buildStarterLibrary(starterEntry.profile, starterEntry.presets))
            }
          >
            Starter Presets
          </Button>
        ) : null}
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
  const project = useStore((state) => state.project);
  const layers = useStore((state) => state.project.scene.layers);
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const setMaterialLibrary = useStore((state) => state.setMaterialLibrary);
  const markMaterialLibrarySaved = useStore((state) => state.markMaterialLibrarySaved);
  const assignMaterialPresetToLayer = useStore((state) => state.assignMaterialPresetToLayer);
  const updateMaterialPresetFromLayer = useStore((state) => state.updateMaterialPresetFromLayer);
  const deleteMaterialPreset = useStore((state) => state.deleteMaterialPreset);
  const pushToast = useToastStore((state) => state.pushToast);
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
  const calibrationContext = materialLibraryCalibrationFromSelection({ project, selectedObjectId });
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
        presetOptions={presetOptions}
        activeLayerId={activeLayerId}
        activePresetId={activePresetId}
        onLayerChange={setTargetLayerId}
        onPresetChange={setPresetId}
      />
      <MaterialLibraryRecipeControls
        activeLayerId={activeLayerId}
        activePresetId={activePresetId}
        entryCount={props.library.entries.length}
        activePresetOption={activePresetOption}
        calibrationContext={calibrationContext}
        onAssign={() => assignMaterialPresetToLayer(activeLayerId, activePresetId)}
        onUpdate={() => updateMaterialPresetFromLayer(activeLayerId, activePresetId)}
        onDelete={() => deleteMaterialPreset(activePresetId)}
        onPresetCreated={(id) => {
          setPresetId(id);
        }}
        onStatus={setStatus}
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
  readonly presetOptions: ReadonlyArray<MaterialLibraryPresetOption>;
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
  return <h2 style={headingStyle}>Material Library</h2>;
}

function activeId(candidate: string, ids: ReadonlyArray<string>): string {
  if (candidate !== '' && ids.includes(candidate)) return candidate;
  return ids[0] ?? '';
}
