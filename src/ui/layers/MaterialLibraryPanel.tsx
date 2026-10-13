import { useState } from 'react';
import './material-library-panel.css';
import { starterLibraryEntryForProfileId } from '../../core/material-library';
import { machineKindOf, type Layer } from '../../core/scene';
import type { MaterialLibraryDocument } from '../../io/material-library';
import { Button } from '../kit';
import { SavedLibrariesButton } from '../material-library/SavedLibrariesButton';
import { MaterialPresetWizardLauncher } from '../material-library/wizard';
import { useStore } from '../state';
import { ProcessRecipePanel } from '../material-library/ProcessRecipePanel';
import { MaterialExperimentsButton } from '../material-library/MaterialExperimentsButton';
import {
  LinkedRecipeChangeReview,
  MaterialRecipePreview,
} from '../material-library/MaterialRecipePreview';
import { buildStarterLibrary } from './material-library-builders';
import {
  materialBindingStatus,
  materialBindingStatusText,
  type MaterialBindingStatus,
} from './material-binding-status';
import { JobMaterialControls } from './JobMaterialControls';
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
  const kind = useStore((state) => machineKindOf(state.project.machine));
  return library === null ? (
    <EmptyMaterialLibraryPanel />
  ) : kind === 'cnc' ? (
    <section className="material-library-panel" aria-label="Process Library" style={sectionStyle}>
      <Header />
      <p style={libraryNameStyle}>{library.name}</p>
      <ProcessRecipePanel />
      <LibraryTools />
    </section>
  ) : (
    <LoadedMaterialLibraryPanel library={library} />
  );
}

function EmptyMaterialLibraryPanel(): JSX.Element {
  const device = useStore((state) => state.project.device);
  const createLibrary = useStore((state) => state.createLibrary);
  const setMaterialLibrary = useStore((state) => state.setMaterialLibrary);
  const kind = useStore((state) => machineKindOf(state.project.machine));
  const starterEntry = kind === 'laser' ? starterLibraryEntryForProfileId(device.profileId) : null;
  return (
    <section
      className="material-library-panel"
      aria-label={kind === 'cnc' ? 'Process Library' : 'Material Library'}
      style={sectionStyle}
    >
      <Header />
      <p style={hintStyle}>Create a library below, or open one from Saved Libraries.</p>
      <div style={buttonRowStyle}>
        <SavedLibrariesButton />
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
  const selection = useMaterialLibrarySelection(props.library);
  const {
    layers,
    presetOptions,
    activeLayerId,
    activePresetId,
    activePresetOption,
    activeLayer,
    query,
    setQuery,
    setPresetId,
    setTargetLayerId,
  } = selection;
  return (
    <section className="material-library-panel" aria-label="Material Library" style={sectionStyle}>
      <Header />
      <p style={libraryNameStyle}>{props.library.name}</p>
      <div className="material-library-panel__intro">
        Find a preset, review its settings and apply it to an operation.
      </div>
      <div className="material-library-panel__card">
        <label style={fieldStyle}>
          <span style={labelStyle}>Find a material preset</span>
          <input
            aria-label="Search material recipes"
            title="Filter recipes by material, thickness, machine or notes before reviewing and choosing a preset."
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Material, thickness, machine or notes"
          />
        </label>
        <MaterialLibrarySelectors
          layers={layers}
          presetOptions={presetOptions}
          activeLayerId={activeLayerId}
          activePresetId={activePresetId}
          onLayerChange={setTargetLayerId}
          onPresetChange={setPresetId}
        />
        {presetOptions.length === 0 ? (
          <p role="status" style={hintStyle}>
            {query.trim() === ''
              ? 'This library has no material presets. Use Create & edit presets below to add one.'
              : 'No matching presets. Try another material or clear the search.'}
          </p>
        ) : null}
        <MaterialRecipePreview
          library={props.library}
          preset={activePresetOption?.preset ?? null}
          layer={activeLayer}
        />
        {layers.some((layer) => layer.materialBinding !== undefined) ? (
          <LinkedRecipeChangeReview library={props.library} layers={layers} />
        ) : null}
        <MaterialRecipeActions library={props.library} selection={selection} />
      </div>
      <MaterialLibraryExtras library={props.library} selection={selection} />
      <LibraryTools />
    </section>
  );
}

function MaterialLibraryExtras(props: {
  readonly library: MaterialLibraryDocument;
  readonly selection: ReturnType<typeof useMaterialLibrarySelection>;
}): JSX.Element {
  const { activePresetOption, setPresetId } = props.selection;
  return (
    <>
      <details className="material-library-panel__disclosure">
        <summary>Job material &amp; automatic presets</summary>
        <div className="material-library-panel__details">
          <JobMaterialControls library={props.library} />
        </div>
      </details>
      <details className="material-library-panel__disclosure">
        <summary>Multi-step process recipes</summary>
        <div className="material-library-panel__details">
          <ProcessRecipePanel />
        </div>
      </details>
      <details className="material-library-panel__disclosure">
        <summary>Create &amp; edit presets</summary>
        <div className="material-library-panel__details">
          <MaterialPresetWizardLauncher
            selectedPreset={activePresetOption?.preset ?? null}
            onSaved={setPresetId}
          />
        </div>
      </details>
    </>
  );
}

function useMaterialLibrarySelection(library: MaterialLibraryDocument) {
  const project = useStore((state) => state.project);
  const layers = useStore((state) => state.project.scene.layers);
  const [targetLayerId, setTargetLayerId] = useState('');
  const [presetId, setPresetId] = useState('');
  const [query, setQuery] = useState('');
  const presetOptions = materialLibraryPresetOptions(project.device, library.entries).filter(
    (option) =>
      `${option.label} ${option.preset.description} ${option.preset.calibrationProvenance ?? ''}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
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
  return {
    layers,
    presetOptions,
    activeLayerId,
    activePresetId,
    activePresetOption,
    activeLayer,
    query,
    setQuery,
    setPresetId,
    setTargetLayerId,
  };
}

function MaterialRecipeActions(props: {
  readonly library: MaterialLibraryDocument;
  readonly selection: ReturnType<typeof useMaterialLibrarySelection>;
}): JSX.Element {
  const { activeLayerId, activePresetId, activePresetOption, activeLayer } = props.selection;
  const assignMaterialPresetToLayer = useStore((state) => state.assignMaterialPresetToLayer);
  const linkMaterialPresetToLayer = useStore((state) => state.linkMaterialPresetToLayer);
  const refreshLinkedMaterialLayer = useStore((state) => state.refreshLinkedMaterialLayer);
  const deleteMaterialPreset = useStore((state) => state.deleteMaterialPreset);
  const [status, setStatus] = useState('');
  const bindingStatus = materialBindingStatus(activeLayer?.materialBinding, props.library);
  return (
    <>
      <MaterialLibraryRecipeControls
        activeLayerId={activeLayerId}
        targetName={activeLayer?.name}
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
    </>
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
      <label style={fieldStyle}>
        <span style={labelStyle}>Apply to operation</span>
        <span style={layerControlStyle}>
          {/* Swatch background is scene data (the layer color), inline per ADR-047. */}
          {activeLayer === null ? null : (
            <span style={{ ...swatchStyle, background: activeLayer.color }} />
          )}
          <select
            aria-label="Material library target layer"
            value={props.activeLayerId}
            disabled={props.layers.length === 0}
            title="Choose which operation receives the selected material preset."
            onChange={(event) => props.onLayerChange(event.currentTarget.value)}
          >
            {props.layers.length === 0 ? <option value="">No operations</option> : null}
            {props.layers.map((layer, index) => (
              <option key={layer.id} value={layer.id}>
                {layer.name.trim() || `Operation ${index + 1}`}
              </option>
            ))}
          </select>
        </span>
      </label>
    </>
  );
}

function Header(): JSX.Element {
  const kind = useStore((state) => machineKindOf(state.project.machine));
  return <h2 style={headingStyle}>{kind === 'cnc' ? 'Process Library' : 'Material Library'}</h2>;
}

function LibraryTools(): JSX.Element {
  return (
    <details className="material-library-panel__disclosure">
      <summary>Libraries &amp; experiments</summary>
      <div className="material-library-panel__details material-library-panel__tools">
        <SavedLibrariesButton />
        <MaterialExperimentsButton />
      </div>
    </details>
  );
}

function activeId(candidate: string, ids: ReadonlyArray<string>): string {
  if (candidate !== '' && ids.includes(candidate)) return candidate;
  return ids[0] ?? '';
}

const layerControlStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 1,
  minWidth: 0,
};
const swatchStyle: React.CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: 3,
  border: '1px solid var(--lf-border-strong)',
  flexShrink: 0,
};
