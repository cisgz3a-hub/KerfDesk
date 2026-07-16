import { useState } from 'react';
import {
  captureLayerOperationSettings,
  operationArtworkCount,
  operationIdsForObject,
  type Layer,
  type LayerMode,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { CncLayerFields } from './CncLayerFields';
import { LayerRowCutSettings } from './LayerRowCutSettings';
import { LayerRowSettingsFields } from './LayerRowFields';
import { useCutSettingsLauncher } from './use-cut-settings-launcher';

export function SelectedOperationInspector(props: {
  readonly objects: ReadonlyArray<SceneObject>;
}): JSX.Element | null {
  const layers = useStore((state) => state.project.scene.layers);
  const machineKind = useStore((state) => state.project.machine?.kind ?? 'laser');
  const assignOperation = useStore((state) => state.useOperationForSelection);
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const context = selectionOperationContext(props.objects, layers);
  if (context.candidates.length === 0) return null;
  const active =
    context.candidates.find((operation) => operation.id === requestedId) ??
    context.common[0] ??
    context.candidates[0];
  if (active === undefined) return null;

  if (context.common.length === 0) {
    return (
      <section aria-label="Multiple artwork operations" style={inspectorStyle}>
        <h3 style={headingStyle}>Multiple operations</h3>
        <p style={hintStyle}>
          {props.objects.length} selected artworks currently keep independent settings.
        </p>
        <OperationSelect
          operations={context.candidates}
          value={active.id}
          onChange={setRequestedId}
        />
        <button
          type="button"
          title="Assign one shared operation and its settings to every selected artwork"
          onClick={() => assignOperation(active.id)}
          style={primaryButtonStyle}
        >
          Use one operation for selection
        </button>
      </section>
    );
  }

  return (
    <SelectedOperationEditor
      active={active}
      candidates={context.candidates}
      objects={props.objects}
      machineKind={machineKind}
      onSelect={setRequestedId}
    />
  );
}

function SelectedOperationEditor(props: {
  readonly active: Layer;
  readonly candidates: ReadonlyArray<Layer>;
  readonly objects: ReadonlyArray<SceneObject>;
  readonly machineKind: 'laser' | 'cnc';
  readonly onSelect: (id: string) => void;
}): JSX.Element {
  const makeUnique = useStore((state) => state.makeSelectedOperationUnique);
  const addOperation = useStore((state) => state.addOperationForSelection);
  const renameOperation = useStore((state) => state.renameOperation);
  const allObjects = useStore((state) => state.project.scene.objects);
  const layers = useStore((state) => state.project.scene.layers);
  const affected = operationArtworkCount(allObjects, props.active);
  const selectedUsingActive = props.objects.filter((object) =>
    operationIdsForObject(object, layers).includes(props.active.id),
  ).length;
  return (
    <section aria-label="Selected artwork operation" style={inspectorStyle}>
      <div style={titleRowStyle}>
        <span style={{ ...swatchStyle, background: props.active.color }} />
        <input
          key={`${props.active.id}:${props.active.name}`}
          defaultValue={props.active.name}
          aria-label="Operation name"
          title="Name this process operation"
          style={nameInputStyle}
          onBlur={(event) => renameOperation(props.active.id, event.currentTarget.value)}
        />
      </div>
      {props.candidates.length > 1 ? (
        <OperationSelect
          operations={props.candidates}
          value={props.active.id}
          onChange={props.onSelect}
        />
      ) : null}
      <div style={contextRowStyle}>
        <span>
          Affects {affected} artwork{affected === 1 ? '' : 's'}
        </span>
        {affected > selectedUsingActive ? (
          <button
            type="button"
            title="Give only the selected artwork a copy of these operation settings"
            onClick={() => makeUnique(props.active.id)}
          >
            Make unique
          </button>
        ) : null}
        <button
          type="button"
          title="Add another process operation to the selected artwork"
          onClick={addOperation}
        >
          Add operation
        </button>
      </div>
      <OperationToggles operation={props.active} />
      {props.machineKind === 'cnc' ? (
        <CncLayerFields layer={props.active} />
      ) : (
        <LaserOperationFields operation={props.active} />
      )}
      <CompatibilityNote
        objects={props.objects}
        operation={props.active}
        machineKind={props.machineKind}
      />
    </section>
  );
}

function LaserOperationFields(props: { readonly operation: Layer }): JSX.Element {
  const setLayerParam = useStore((state) => state.setLayerParam);
  const { settingsOpen, cutSettingsBlocked, openSettings, closeSettings } =
    useCutSettingsLauncher();
  const target = {
    settings: captureLayerOperationSettings(props.operation),
    selectedObjectCount: 0,
    ariaContext: 'selected objects',
    commit: (patch: Partial<ReturnType<typeof captureLayerOperationSettings>>) =>
      setLayerParam(props.operation.id, patch),
  };
  return (
    <>
      <label style={fieldRowStyle}>
        <span>Process</span>
        <select
          value={props.operation.mode}
          aria-label="Mode for selected objects"
          title="Choose how the laser processes the selected artwork"
          onChange={(event) =>
            setLayerParam(props.operation.id, { mode: event.target.value as LayerMode })
          }
        >
          <option value="line">Line</option>
          <option value="fill">Fill</option>
          <option value="image">Image</option>
        </select>
      </label>
      <LayerRowSettingsFields layer={props.operation} operationTarget={target} />
      <label title="Turn job-controlled air assist on for this operation" style={airAssistStyle}>
        <input
          type="checkbox"
          checked={props.operation.airAssist}
          aria-label="Air assist for selected operation"
          title="Turn job-controlled air assist on for this operation"
          onChange={(event) =>
            setLayerParam(props.operation.id, { airAssist: event.target.checked })
          }
        />{' '}
        Air assist
      </label>
      <button
        type="button"
        title="Open advanced laser operation settings"
        onClick={openSettings}
        disabled={cutSettingsBlocked}
      >
        Advanced cut settings
      </button>
      {settingsOpen ? (
        <LayerRowCutSettings layer={props.operation} onClose={closeSettings} />
      ) : null}
    </>
  );
}

function OperationToggles(props: { readonly operation: Layer }): JSX.Element {
  const setLayerParam = useStore((state) => state.setLayerParam);
  return (
    <div style={toggleRowStyle}>
      <label>
        <input
          type="checkbox"
          checked={props.operation.visible}
          title="Show or hide this operation on the workspace"
          onChange={(event) => setLayerParam(props.operation.id, { visible: event.target.checked })}
        />{' '}
        Show on canvas
      </label>
      <label>
        <input
          type="checkbox"
          checked={props.operation.output}
          title="Include this operation in preview and machine output"
          onChange={(event) => setLayerParam(props.operation.id, { output: event.target.checked })}
        />{' '}
        Include in output
      </label>
    </div>
  );
}

function OperationSelect(props: {
  readonly operations: ReadonlyArray<Layer>;
  readonly value: string;
  readonly onChange: (id: string) => void;
}): JSX.Element {
  return (
    <label style={fieldRowStyle}>
      <span>Operation</span>
      <select
        aria-label="Operation for selected artwork"
        title="Choose which operation to inspect for the selected artwork"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.operations.map((operation) => (
          <option key={operation.id} value={operation.id}>
            {operation.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function CompatibilityNote(props: {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly operation: Layer;
  readonly machineKind: 'laser' | 'cnc';
}): JSX.Element | null {
  if (
    props.machineKind === 'cnc' &&
    props.objects.some((object) => object.kind === 'raster-image')
  ) {
    return (
      <p style={advisoryStyle}>Raster artwork is visible, but CNC output needs vector contours.</p>
    );
  }
  if (props.machineKind === 'laser' && props.objects.some((object) => object.kind === 'relief')) {
    return (
      <p style={advisoryStyle}>Relief artwork is a CNC operation and has no laser toolpath.</p>
    );
  }
  if (
    props.machineKind === 'laser' &&
    props.operation.mode !== 'image' &&
    props.objects.some((object) => object.kind === 'raster-image')
  ) {
    return <p style={advisoryStyle}>Raster artwork needs an Image process for laser output.</p>;
  }
  if (
    props.machineKind === 'laser' &&
    props.operation.mode === 'image' &&
    props.objects.some((object) => 'paths' in object)
  ) {
    return (
      <p style={advisoryStyle}>Vector artwork needs a Line or Fill process for laser output.</p>
    );
  }
  return null;
}

function selectionOperationContext(
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer>,
) {
  const idsByObject = objects.map((object) => operationIdsForObject(object, layers));
  const candidateIds = [...new Set(idsByObject.flat())];
  const commonIds = candidateIds.filter((id) => idsByObject.every((ids) => ids.includes(id)));
  return {
    candidates: candidateIds.flatMap((id) => layers.find((layer) => layer.id === id) ?? []),
    common: commonIds.flatMap((id) => layers.find((layer) => layer.id === id) ?? []),
  };
}

const inspectorStyle: React.CSSProperties = {
  border: '1px solid var(--lf-accent)',
  borderRadius: 6,
  padding: 10,
  marginBottom: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
const headingStyle: React.CSSProperties = { margin: 0, fontSize: 14 };
const hintStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-text-muted)' };
const titleRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const swatchStyle: React.CSSProperties = { width: 18, height: 18, borderRadius: 4, flexShrink: 0 };
const nameInputStyle: React.CSSProperties = { minWidth: 0, flex: 1, fontWeight: 600 };
const contextRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  alignItems: 'center',
  fontSize: 12,
};
const toggleRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  fontSize: 12,
};
const airAssistStyle: React.CSSProperties = { fontSize: 12 };
const fieldRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '92px 1fr',
  gap: 8,
  alignItems: 'center',
};
const primaryButtonStyle: React.CSSProperties = { minHeight: 34 };
const advisoryStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-warning)', fontSize: 12 };
