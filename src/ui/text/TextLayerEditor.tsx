import { useState } from 'react';
import {
  captureLayerOperationSettings,
  machineKindOf,
  type CncLayerSettings,
  type Layer,
  type LayerMode,
  type LayerOperationSettings,
} from '../../core/scene';
import { Button } from '../kit';
import { CncLayerFields } from '../layers/CncLayerFields';
import { LayerRowSettingsFields } from '../layers/LayerRowFields';
import { useStore } from '../state';

export function TextLayerEditor(props: {
  readonly layer: Layer;
  readonly isNew: boolean;
  readonly reservedColors: ReadonlyArray<string>;
  readonly onSave: (layer: Layer) => void;
  readonly onCancel: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState(props.layer);
  const [colorError, setColorError] = useState<string | null>(null);
  const machineKind = useStore((s) => machineKindOf(s.project.machine));
  const operationTarget = {
    settings: captureLayerOperationSettings(draft),
    selectedObjectCount: 0,
    commit: (patch: Partial<LayerOperationSettings>) =>
      setDraft((current) => ({ ...current, ...patch })),
  };
  const changeColor = (color: string): void => {
    if (props.reservedColors.includes(color)) {
      setColorError('That color already belongs to another layer. Choose a different color.');
      return;
    }
    setColorError(null);
    setDraft((current) => ({
      ...current,
      ...(props.isNew ? { id: color } : {}),
      color,
    }));
  };
  const changeCnc = (cnc: CncLayerSettings): void => setDraft((current) => ({ ...current, cnc }));
  const changeMode = (mode: LayerMode): void => setDraft((current) => ({ ...current, mode }));
  return (
    <section aria-label={`Edit output layer ${draft.color}`} style={editorStyle}>
      <EditorHeader
        isNew={props.isNew}
        saveDisabled={colorError !== null}
        onCancel={props.onCancel}
        onSave={() => props.onSave(draft)}
      />
      <LayerColorField layer={draft} onChange={changeColor} />
      {colorError === null ? null : (
        <span role="alert" style={errorStyle}>
          {colorError}
        </span>
      )}
      {machineKind === 'cnc' ? (
        <CncLayerFields layer={draft} onSettingsChange={changeCnc} />
      ) : (
        <>
          <label style={rowStyle}>
            <span style={labelStyle}>Mode</span>
            <select
              value={draft.mode}
              onChange={(event) => changeMode(event.target.value as LayerMode)}
              aria-label={`Mode for ${draft.color}`}
              title="Choose line, fill, or image output for this layer."
            >
              <option value="line">Line</option>
              <option value="fill">Fill</option>
              <option value="image">Image</option>
            </select>
          </label>
          <LayerRowSettingsFields layer={draft} operationTarget={operationTarget} />
        </>
      )}
      <p style={syncHintStyle}>
        {props.isNew
          ? 'Save creates this output in the main Cuts / Layers panel before text is added.'
          : 'Save updates this output in the main Cuts / Layers panel.'}
      </p>
    </section>
  );
}

function EditorHeader(props: {
  readonly isNew: boolean;
  readonly saveDisabled: boolean;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}): JSX.Element {
  return (
    <header style={headerStyle}>
      <strong style={titleStyle}>{props.isNew ? 'New layer settings' : 'Layer settings'}</strong>
      <span style={headerActionsStyle}>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button variant="primary" disabled={props.saveDisabled} onClick={props.onSave}>
          Save
        </Button>
      </span>
    </header>
  );
}

function LayerColorField(props: {
  readonly layer: Layer;
  readonly onChange: (color: string) => void;
}): JSX.Element {
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>Color</span>
      <input
        type="color"
        value={props.layer.color}
        onChange={(event) => props.onChange(event.target.value.toLowerCase())}
        aria-label="Layer color"
        title="Choose the output layer color."
      />
      <code>{props.layer.color}</code>
    </label>
  );
}

const editorStyle: React.CSSProperties = {
  width: '100%',
  maxHeight: 280,
  boxSizing: 'border-box',
  overflowY: 'auto',
  padding: 10,
  display: 'grid',
  gap: 6,
  background: 'var(--lf-bg-2)',
  border: '1px solid var(--lf-border-strong)',
  borderRadius: 6,
  boxShadow: 'var(--lf-shadow)',
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};
const headerActionsStyle: React.CSSProperties = { display: 'flex', gap: 6 };
const titleStyle: React.CSSProperties = { fontSize: 12 };
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 28,
};
const labelStyle: React.CSSProperties = {
  width: 96,
  flexShrink: 0,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
const syncHintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};
const errorStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-danger-fg)' };
