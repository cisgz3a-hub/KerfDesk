import { useState } from 'react';
import { useStore } from '../state';
import { TextLayerEditor } from './TextLayerEditor';
import type { TextLayerNotice, TextLayerOption } from './text-layer-options';

export function TextLayerField(props: {
  readonly value: string;
  readonly options: ReadonlyArray<TextLayerOption>;
  readonly notice?: TextLayerNotice;
  readonly onChange: (color: string) => void;
}): JSX.Element {
  const [editorOpen, setEditorOpen] = useState(false);
  const layer = useStore((s) => s.project.scene.layers.find((item) => item.color === props.value));
  const selected = props.options.find((option) => option.color === props.value);
  const selectLayer = (color: string): void => {
    props.onChange(color);
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
          <button
            type="button"
            onClick={() => setEditorOpen((open) => !open)}
            disabled={layer === undefined}
            title={
              layer === undefined
                ? 'Add the text to create this layer before editing its operation.'
                : 'Edit this layer here; changes also update the main Cuts / Layers panel.'
            }
            aria-expanded={editorOpen}
            style={editButtonStyle}
          >
            Edit
          </button>
        </span>
        {selected !== undefined ? (
          <span style={summaryStyle} title={`${selected.label}: ${selected.summary}`}>
            {selected.summary}
          </span>
        ) : null}
        {editorOpen && layer !== undefined ? (
          <TextLayerEditor
            layer={layer}
            onColorChange={props.onChange}
            onClose={() => setEditorOpen(false)}
          />
        ) : null}
        {props.notice !== undefined ? <LayerNotice notice={props.notice} /> : null}
      </span>
    </div>
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
