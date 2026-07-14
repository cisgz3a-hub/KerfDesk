import { useState } from 'react';
import {
  captureLayerOperationSettings,
  machineKindOf,
  type Layer,
  type LayerMode,
} from '../../core/scene';
import { CncLayerFields } from '../layers/CncLayerFields';
import { LayerRowSettingsFields } from '../layers/LayerRowFields';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';

export function TextLayerEditor(props: {
  readonly layer: Layer;
  readonly onColorChange: (color: string) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const { layer } = props;
  const machineKind = useStore((s) => machineKindOf(s.project.machine));
  const setLayerParam = useStore((s) => s.setLayerParam);
  const { colorError, changeColor } = useLayerColorSync(layer, props.onColorChange);
  const operationTarget = {
    settings: captureLayerOperationSettings(layer),
    selectedObjectCount: 0,
    commit: (patch: Parameters<typeof setLayerParam>[1]) => setLayerParam(layer.id, patch),
  };
  return (
    <section aria-label={`Edit output layer ${layer.color}`} style={editorStyle}>
      <header style={headerStyle}>
        <strong style={titleStyle}>Layer settings</strong>
        <button
          type="button"
          onClick={props.onClose}
          title="Close the layer settings box."
          aria-label="Close layer settings"
        >
          Done
        </button>
      </header>
      <LayerColorField layer={layer} onChange={changeColor} />
      {colorError === null ? null : (
        <span role="alert" style={errorStyle}>
          {colorError}
        </span>
      )}
      {machineKind === 'cnc' ? (
        <CncLayerFields layer={layer} />
      ) : (
        <>
          <label style={rowStyle}>
            <span style={labelStyle}>Mode</span>
            <select
              value={layer.mode}
              onChange={(event) =>
                setLayerParam(layer.id, { mode: event.target.value as LayerMode })
              }
              aria-label={`Mode for ${layer.color}`}
              title="Choose line, fill, or image output for this layer."
            >
              <option value="line">Line</option>
              <option value="fill">Fill</option>
              <option value="image">Image</option>
            </select>
          </label>
          <LayerRowSettingsFields layer={layer} operationTarget={operationTarget} />
        </>
      )}
      <p style={syncHintStyle}>Changes are shared with the main Cuts / Layers panel.</p>
    </section>
  );
}

function useLayerColorSync(layer: Layer, onColorChange: (color: string) => void) {
  const layers = useStore((s) => s.project.scene.layers);
  const setLayerColor = useStore((s) => s.setLayerColor);
  const activeLayerColor = useUiStore((s) => s.activeLayerColor);
  const setActiveLayerColor = useUiStore((s) => s.setActiveLayerColor);
  const [colorError, setColorError] = useState<string | null>(null);
  const changeColor = (color: string): void => {
    if (layers.some((candidate) => candidate.id !== layer.id && candidate.color === color)) {
      setColorError('That color already belongs to another layer. Choose a different color.');
      return;
    }
    setColorError(null);
    setLayerColor(layer.id, color);
    onColorChange(color);
    if (activeLayerColor === layer.color) setActiveLayerColor(color);
  };
  return { colorError, changeColor };
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
        title="Change this layer color everywhere it is used."
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
