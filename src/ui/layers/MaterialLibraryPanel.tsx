import { useState } from 'react';
import { starterLibraryEntryForProfileId } from '../../core/material-library';
import type { Layer } from '../../core/scene';
import type { MaterialLibraryDocument } from '../../io/material-library';
import { Button } from '../kit';
import { SavedLibrariesButton } from '../material-library/SavedLibrariesButton';
import { MaterialPresetWizardLauncher } from '../material-library/wizard';
import { useStore } from '../state';
import { buildStarterLibrary } from './material-library-builders';
import {
  materialBindingStatus,
  materialBindingStatusText,
  type MaterialBindingStatus,
} from './material-binding-status';
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
  const starterEntry = starterLibraryEntryForProfileId(device.profileId);
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
  const linkMaterialPresetToLayer = useStore((state) => state.linkMaterialPresetToLayer);
  const refreshLinkedMaterialLayer = useStore((state) => state.refreshLinkedMaterialLayer);
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
  const activeLayer = layers.find((layer) => layer.id === activeLayerId) ?? null;
  const bindingStatus = materialBindingStatus(activeLayer?.materialBinding, props.library);
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
        onLink={() => linkMaterialPresetToLayer(activeLayerId, activePresetId)}
        onDelete={() => deleteMaterialPreset(activePresetId)}
        onStatus={setStatus}
      />
      <LinkedMaterialRefresh
        binding={activeLayer?.materialBinding}
        status={bindingStatus}
        onRefresh={() => {
          const refreshed = refreshLinkedMaterialLayer(activeLayerId);
          setStatus(
            refreshed
              ? 'Linked preset refreshed from the current library revision.'
              : 'Linked preset is already current or could not be refreshed from this library.',
          );
        }}
      />
      {status !== '' ? <p style={statusStyle}>{status}</p> : null}
      {activeLayer?.materialBinding !== undefined && bindingStatus !== null ? (
        <p role="status" style={statusStyle}>
          {materialBindingStatusText(activeLayer.materialBinding, bindingStatus)}
        </p>
      ) : null}
    </section>
  );
}

function LinkedMaterialRefresh(props: {
  readonly binding: Layer['materialBinding'];
  readonly status: MaterialBindingStatus | null;
  readonly onRefresh: () => void;
}): JSX.Element | null {
  if (props.binding === undefined || props.status === null) return null;
  const sourceAvailable = props.status.entry !== null;
  return (
    <div style={buttonRowStyle}>
      <Button
        aria-label="Refresh linked material preset"
        title={
          sourceAvailable
            ? 'Explicitly copy the current linked preset revision onto this layer.'
            : 'Reload the linked material library or restore the missing preset before refreshing.'
        }
        disabled={!sourceAvailable}
        onClick={props.onRefresh}
      >
        Refresh linked preset
      </Button>
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
