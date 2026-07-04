import { useState } from 'react';
import {
  layerFromSubLayer,
  type Layer,
  type LayerMode,
  type LayerOperationSettings,
  type LayerSubLayer,
} from '../../core/scene';
import { useStore } from '../state';
import { CutSettingsDialog } from './CutSettingsDialog';
import type { LayerPatch } from './cut-settings-draft';

const panelStyle: React.CSSProperties = {
  borderTop: '1px solid var(--lf-border)',
  paddingTop: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};
const titleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--lf-text-muted)',
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  overflow: 'hidden',
};
const rowLabelStyle: React.CSSProperties = {
  flex: '1 1 76px',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const modeSelectStyle: React.CSSProperties = {
  flex: '0 1 64px',
  minWidth: 58,
  fontSize: 12,
  padding: '2px 4px',
};
const numericStyle: React.CSSProperties = { width: 58, padding: '2px 4px', fontSize: 12 };

export function LayerSubLayers({ layer }: { readonly layer: Layer }): JSX.Element {
  const addLayerSubLayer = useStore((state) => state.addLayerSubLayer);
  return (
    <section style={panelStyle} aria-label={`Sub-layers for ${layer.color}`}>
      <div style={headerStyle}>
        <span style={titleStyle}>Sub-layers</span>
        <button
          type="button"
          onClick={() => addLayerSubLayer(layer.id)}
          aria-label={`Add sub-layer for ${layer.color}`}
          title="Add another operation that runs after this layer's primary operation."
        >
          Add
        </button>
      </div>
      {layer.subLayers.map((subLayer) => (
        <LayerSubLayerRow key={subLayer.id} layer={layer} subLayer={subLayer} />
      ))}
    </section>
  );
}

function LayerSubLayerRow(props: {
  readonly layer: Layer;
  readonly subLayer: LayerSubLayer;
}): JSX.Element {
  const { layer, subLayer } = props;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const maxFeed = useStore((state) => state.project.device.maxFeed);
  const updateLayerSubLayer = useStore((state) => state.updateLayerSubLayer);
  const deleteLayerSubLayer = useStore((state) => state.deleteLayerSubLayer);
  const effectiveLayer = layerFromSubLayer(layer, subLayer);
  return (
    <div style={rowStyle}>
      <input
        type="checkbox"
        checked={subLayer.enabled}
        onChange={(event) =>
          updateLayerSubLayer(layer.id, subLayer.id, { enabled: event.target.checked })
        }
        aria-label={`Enable ${subLayer.label} for ${layer.color}`}
        title="Include this sub-layer operation in output."
      />
      <span style={rowLabelStyle} title={subLayer.label}>
        {subLayer.label}
      </span>
      <ModeSelect layer={layer} subLayer={subLayer} />
      <PowerInput layer={layer} subLayer={subLayer} />
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        aria-label={`Edit ${subLayer.label} for ${layer.color}`}
        title="Open advanced cut settings for this sub-layer."
      >
        Edit
      </button>
      <button
        type="button"
        onClick={() => deleteLayerSubLayer(layer.id, subLayer.id)}
        aria-label={`Delete ${subLayer.label} for ${layer.color}`}
        title="Delete this sub-layer operation."
      >
        Delete
      </button>
      {settingsOpen ? (
        <CutSettingsDialog
          layer={effectiveLayer}
          maxFeed={maxFeed}
          onCancel={() => setSettingsOpen(false)}
          onApply={(patch) => {
            updateLayerSubLayer(layer.id, subLayer.id, subLayerPatchFromDialog(patch));
            setSettingsOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function ModeSelect(props: {
  readonly layer: Layer;
  readonly subLayer: LayerSubLayer;
}): JSX.Element {
  const updateLayerSubLayer = useStore((state) => state.updateLayerSubLayer);
  return (
    <select
      value={props.subLayer.settings.mode}
      onChange={(event) =>
        updateLayerSubLayer(props.layer.id, props.subLayer.id, {
          mode: event.target.value as LayerMode,
        })
      }
      aria-label={`Mode for ${props.subLayer.label} ${props.layer.color}`}
      title="Choose the operation mode for this sub-layer."
      style={modeSelectStyle}
    >
      <option value="line">Line</option>
      <option value="fill">Fill</option>
      <option value="image">Image</option>
    </select>
  );
}

function PowerInput(props: {
  readonly layer: Layer;
  readonly subLayer: LayerSubLayer;
}): JSX.Element {
  const updateLayerSubLayer = useStore((state) => state.updateLayerSubLayer);
  return (
    <input
      type="number"
      min={0}
      max={100}
      value={props.subLayer.settings.power}
      onChange={(event) => {
        const power = clamp(Number.parseFloat(event.target.value), 0, 100);
        updateLayerSubLayer(props.layer.id, props.subLayer.id, {
          power,
          minPower: Math.min(props.subLayer.settings.minPower, power),
        });
      }}
      aria-label={`Power for ${props.subLayer.label} ${props.layer.color}`}
      title="Laser power percentage for this sub-layer."
      style={numericStyle}
    />
  );
}

function subLayerPatchFromDialog(patch: LayerPatch): Partial<LayerOperationSettings> & {
  readonly enabled?: boolean;
} {
  const { visible: _visible, output, subLayers: _subLayers, ...settings } = patch;
  return {
    ...settings,
    ...(output !== undefined ? { enabled: output } : {}),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
