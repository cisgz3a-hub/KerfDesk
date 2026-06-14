import { useState } from 'react';
import type { DeviceProfile } from '../../core/devices';
import type { Layer } from '../../core/scene';
import {
  createMaterialLibraryDeviceHint,
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
} from '../../io/material-library';
import {
  handleOpenMaterialLibrary,
  handleSaveMaterialLibrary,
} from '../app/material-library-file-actions';
import { usePlatform } from '../app/platform-context';
import { Button } from '../kit';
import { useStore } from '../state';
import type { CreateMaterialPresetInput } from '../state/material-library-actions';
import { useToastStore } from '../state/toast-store';
import {
  buttonRowStyle,
  fieldStyle,
  formStyle,
  headingStyle,
  labelStyle,
  libraryHeaderStyle,
  libraryNameStyle,
  sectionStyle,
  splitRowStyle,
  statusStyle,
} from './material-library-panel-styles';

type CreateDraft = {
  readonly materialName: string;
  readonly thicknessMm: string;
  readonly title: string;
  readonly description: string;
};

const EMPTY_DRAFT: CreateDraft = { materialName: '', thicknessMm: '', title: '', description: '' };

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

function CreatePresetForm(props: {
  readonly targetLayerId: string;
  readonly entryCount: number;
  readonly onCreated: (id: string) => void;
  readonly onFailed: (message: string) => void;
}): JSX.Element {
  const createMaterialPresetFromLayer = useStore((state) => state.createMaterialPresetFromLayer);
  const [draft, setDraft] = useState<CreateDraft>(EMPTY_DRAFT);
  const createInput = createPresetInput(draft, props.entryCount);
  const createDisabled = props.targetLayerId === '' || createInput === null;
  return (
    <form
      style={formStyle}
      onSubmit={(event) => {
        event.preventDefault();
        if (createInput === null) {
          props.onFailed('Enter a material name, description, and thickness or title.');
          return;
        }
        const created = createMaterialPresetFromLayer(props.targetLayerId, createInput);
        if (created === null) {
          props.onFailed('Preset was not created.');
          return;
        }
        props.onCreated(created.id);
      }}
    >
      <input
        aria-label="Material name"
        placeholder="Material"
        value={draft.materialName}
        onChange={(event) => setDraftValue(setDraft, 'materialName', event.currentTarget.value)}
      />
      <div style={splitRowStyle}>
        <input
          aria-label="Material thickness millimeters"
          placeholder="Thickness mm"
          value={draft.thicknessMm}
          onChange={(event) => setDraftValue(setDraft, 'thicknessMm', event.currentTarget.value)}
        />
        <input
          aria-label="No thickness title"
          placeholder="Title"
          value={draft.title}
          onChange={(event) => setDraftValue(setDraft, 'title', event.currentTarget.value)}
        />
      </div>
      <input
        aria-label="Preset description"
        placeholder="Description"
        value={draft.description}
        onChange={(event) => setDraftValue(setDraft, 'description', event.currentTarget.value)}
      />
      <Button
        type="submit"
        aria-label="Create preset from selected layer"
        title="Create a new material preset from the selected layer settings."
        disabled={createDisabled}
      >
        Create from Layer
      </Button>
    </form>
  );
}

function Header(): JSX.Element {
  return <h2 style={headingStyle}>Material Library</h2>;
}

function setDraftValue(
  setDraft: React.Dispatch<React.SetStateAction<CreateDraft>>,
  key: keyof CreateDraft,
  value: string,
): void {
  setDraft((current) => ({ ...current, [key]: value }));
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

function activeId(candidate: string, ids: ReadonlyArray<string>): string {
  if (candidate !== '' && ids.includes(candidate)) return candidate;
  return ids[0] ?? '';
}

function createPresetInput(
  draft: CreateDraft,
  existingCount: number,
): CreateMaterialPresetInput | null {
  const materialName = draft.materialName.trim();
  const description = draft.description.trim();
  const title = draft.title.trim();
  const thicknessText = draft.thicknessMm.trim();
  const hasTitle = title.length > 0;
  const hasThickness = thicknessText.length > 0;

  if (materialName.length === 0 || description.length === 0) return null;
  if (hasTitle === hasThickness) return null;

  if (hasThickness) {
    const thicknessMm = Number(thicknessText);
    if (!Number.isFinite(thicknessMm) || thicknessMm <= 0) return null;
    return {
      id: presetIdFor(
        materialName,
        `${formatThickness(thicknessMm)}mm`,
        description,
        existingCount,
      ),
      materialName,
      thicknessMm,
      description,
      revision: `manual-${existingCount + 1}`,
    };
  }

  return {
    id: presetIdFor(materialName, title, description, existingCount),
    materialName,
    title,
    description,
    revision: `manual-${existingCount + 1}`,
  };
}

function presetIdFor(
  materialName: string,
  label: string,
  description: string,
  existingCount: number,
): string {
  return `${slug(materialName)}-${slug(label)}-${slug(description).slice(0, 24)}-${
    existingCount + 1
  }`;
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
