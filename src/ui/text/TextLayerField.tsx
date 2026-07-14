import { useState } from 'react';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { TextLayerEditor } from './TextLayerEditor';
import type { TextLayerNotice, TextLayerOption } from './text-layer-options';

export function TextLayerField(props: {
  readonly value: string;
  readonly options: ReadonlyArray<TextLayerOption>;
  readonly notice?: TextLayerNotice;
  readonly onChange: (color: string) => void;
}): JSX.Element {
  const [editorOpen, setEditorOpen] = useState(false);
  const layers = useStore((s) => s.project.scene.layers);
  const commitLayerDraft = useStore((s) => s.commitLayerDraft);
  const activeLayerColor = useUiStore((s) => s.activeLayerColor);
  const setActiveLayerColor = useUiStore((s) => s.setActiveLayerColor);
  const selected = props.options.find((option) => option.color === props.value);
  const selectLayer = (color: string): void => {
    props.onChange(color);
    setEditorOpen(false);
  };
  const saveLayer = (layer: TextLayerOption['layer']): void => {
    commitLayerDraft(layer);
    props.onChange(layer.color);
    if (selected !== undefined && activeLayerColor === selected.color) {
      setActiveLayerColor(layer.color);
    }
    setEditorOpen(false);
  };

  return (
    <div className="lf-field" style={{ alignItems: 'flex-start' }}>
      <span className="lf-field-label lf-field-label--sm" style={{ paddingTop: 4 }}>
        Output layer
      </span>
      <span style={fieldBodyStyle}>
        <span style={selectorRowStyle}>
          <span aria-hidden="true" style={swatchStyle(props.value)} />
          <select
            className="lf-input"
            aria-label="Text output layer"
            title="Choose the layer and operation settings used for this text."
            value={props.value}
            onChange={(event) => selectLayer(event.target.value)}
            style={selectStyle}
          >
            {props.options.map((option) => (
              <option
                key={`${option.color}:${option.isNew ? 'new' : 'existing'}`}
                value={option.color}
              >
                {option.label} ({option.color})
              </option>
            ))}
          </select>
          <LayerEditButton
            isNew={selected?.isNew === true}
            disabled={selected === undefined}
            open={editorOpen}
            onClick={() => setEditorOpen((open) => !open)}
          />
        </span>
        {selected !== undefined ? (
          <span style={summaryStyle} title={`${selected.label}: ${selected.summary}`}>
            {selected.summary}
          </span>
        ) : null}
        {editorOpen && selected !== undefined ? (
          <TextLayerEditor
            layer={selected.layer}
            isNew={selected.isNew}
            reservedColors={layers
              .filter((layer) => selected.isNew || layer.id !== selected.layer.id)
              .map((layer) => layer.color)}
            onSave={saveLayer}
            onCancel={() => setEditorOpen(false)}
          />
        ) : null}
        {props.notice !== undefined ? <LayerNotice notice={props.notice} /> : null}
      </span>
    </div>
  );
}

function LayerEditButton(props: {
  readonly isNew: boolean;
  readonly disabled: boolean;
  readonly open: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      title={
        props.isNew
          ? 'Configure this output before adding text to the canvas.'
          : 'Edit this output, then Save to update the main Cuts / Layers panel.'
      }
      aria-expanded={props.open}
      style={editButtonStyle}
    >
      Edit
    </button>
  );
}

function LayerNotice(props: { readonly notice: TextLayerNotice }): JSX.Element {
  return (
    <span
      role={props.notice.kind === 'error' ? 'alert' : 'status'}
      style={{
        fontSize: 11,
        color: props.notice.kind === 'error' ? 'var(--lf-danger-fg)' : 'var(--lf-warning-fg)',
      }}
    >
      {props.notice.message}
    </span>
  );
}

function swatchStyle(color: string): React.CSSProperties {
  return {
    width: 14,
    height: 14,
    flexShrink: 0,
    borderRadius: 3,
    background: color,
    border: '1px solid var(--lf-border)',
  };
}

const fieldBodyStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'grid',
  gap: 4,
};
const selectorRowStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const selectStyle: React.CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
  maxWidth: '100%',
};
const editButtonStyle: React.CSSProperties = { flexShrink: 0 };
const summaryStyle: React.CSSProperties = {
  minWidth: 0,
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  overflowWrap: 'anywhere',
};
