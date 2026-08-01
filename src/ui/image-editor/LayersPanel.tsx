// The Image Studio Layers panel (ADR-245): top-down stack with visibility
// eyes, the active row highlighted, and the active layer's opacity/blend
// plus the six list actions. History entries carry a layer scope (ADR-246),
// so switching layers keeps undo — Ctrl+Z follows strokes across layers.

import { useState } from 'react';
import { resampleBuffer } from '../../core/image-resample';
import {
  addLayerAboveActive,
  duplicateActiveLayer,
  mergeActiveLayerDown,
  moveActiveLayer,
  moveLayerToIndex,
  removeActiveLayer,
  setActiveLayer,
  setActiveLayerProps,
} from './editor-session-layers';
import type { EditorSession } from './editor-session';
import { useImageEditorStore } from './image-editor-store';

function updateSession(update: (session: EditorSession) => EditorSession): void {
  const { session } = useImageEditorStore.getState();
  if (session === null) return;
  useImageEditorStore.setState({ session: update(session) });
}

export function LayersPanel(): JSX.Element | null {
  const session = useImageEditorStore((s) => s.session);
  const [dragId, setDragId] = useState<string | null>(null);
  if (session === null) return null;
  const active = session.layers.find((layer) => layer.id === session.activeLayerId);
  // Top of the stack renders first (Photoshop reading order).
  const rows = [...session.layers].reverse();
  const stackIndexOfRow = (rowIndex: number): number => session.layers.length - 1 - rowIndex;
  return (
    <section style={panelStyle} aria-label="Layers panel">
      <strong style={headerStyle}>Layers</strong>
      <LayerActions canMerge={session.layers.length > 1} />
      {active === undefined ? null : <ActiveLayerControls active={active} />}
      <div style={listStyle}>
        {rows.map((layer, rowIndex) => (
          <div
            key={layer.id}
            style={rowStyle}
            draggable
            onDragStart={() => setDragId(layer.id)}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId !== null && dragId !== layer.id) {
                updateSession((s) => moveLayerToIndex(s, dragId, stackIndexOfRow(rowIndex)));
              }
              setDragId(null);
            }}
          >
            <LayerThumbnail layer={layer} revision={session.revision} />
            <button
              type="button"
              className="lf-btn lf-btn--ghost"
              style={eyeStyle}
              onClick={() =>
                updateSession((s) =>
                  s.activeLayerId === layer.id
                    ? setActiveLayerProps(s, { isVisible: !layer.isVisible })
                    : setActiveLayerProps(setActiveLayer(s, layer.id), {
                        isVisible: !layer.isVisible,
                      }),
                )
              }
              aria-pressed={layer.isVisible}
              title={layer.isVisible ? 'Hide this layer' : 'Show this layer'}
            >
              {layer.isVisible ? '👁' : '—'}
            </button>
            <button
              type="button"
              className="lf-btn lf-btn--ghost"
              style={{
                ...nameStyle,
                ...(layer.id === session.activeLayerId ? activeNameStyle : null),
              }}
              onClick={() => updateSession((s) => setActiveLayer(s, layer.id))}
              aria-current={layer.id === session.activeLayerId ? 'true' : undefined}
              title="Make this the active paint layer (undo follows your strokes across layers); drag rows to reorder"
            >
              {layer.name}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

const BLEND_VALUES = ['normal', 'multiply', 'screen', 'overlay', 'difference'] as const;

function parseBlend(value: string): (typeof BLEND_VALUES)[number] {
  const match = BLEND_VALUES.find((blend) => blend === value);
  return match ?? 'normal';
}

const THUMB_WIDTH = 28;
const THUMB_HEIGHT = 21;

// A mipmap-downsampled preview of the layer's own pixels (not the
// composite); redrawn when the revision bumps.
function LayerThumbnail(props: {
  readonly layer: EditorSession['layers'][number];
  readonly revision: number;
}): JSX.Element {
  const { layer } = props;
  return (
    <canvas
      width={THUMB_WIDTH}
      height={THUMB_HEIGHT}
      style={thumbStyle}
      aria-hidden="true"
      ref={(canvas) => {
        const ctx = canvas?.getContext('2d') ?? null;
        if (ctx === null) return;
        const small = resampleBuffer(layer.buffer, THUMB_WIDTH, THUMB_HEIGHT);
        ctx.clearRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
        ctx.putImageData(
          new ImageData(new Uint8ClampedArray(small.data), small.width, small.height),
          0,
          0,
        );
      }}
    />
  );
}

function LayerActions(props: { readonly canMerge: boolean }): JSX.Element {
  return (
    <div style={actionsStyle}>
      <button
        type="button"
        className="lf-btn"
        style={actionStyle}
        onClick={() => updateSession((s) => addLayerAboveActive(s, crypto.randomUUID()))}
        title="Add a transparent layer above the active one"
      >
        +
      </button>
      <button
        type="button"
        className="lf-btn"
        style={actionStyle}
        onClick={() => updateSession((s) => duplicateActiveLayer(s, crypto.randomUUID()))}
        title="Duplicate the active layer"
      >
        ⧉
      </button>
      <button
        type="button"
        className="lf-btn"
        style={actionStyle}
        onClick={() => updateSession((s) => moveActiveLayer(s, 1))}
        title="Move the active layer up"
      >
        ↑
      </button>
      <button
        type="button"
        className="lf-btn"
        style={actionStyle}
        onClick={() => updateSession((s) => moveActiveLayer(s, -1))}
        title="Move the active layer down"
      >
        ↓
      </button>
      <button
        type="button"
        className="lf-btn"
        style={actionStyle}
        onClick={() => updateSession((s) => mergeActiveLayerDown(s))}
        disabled={!props.canMerge}
        title="Merge the active layer into the one below it"
      >
        ⤓
      </button>
      <button
        type="button"
        className="lf-btn"
        style={actionStyle}
        onClick={() => updateSession((s) => removeActiveLayer(s))}
        disabled={!props.canMerge}
        title="Delete the active layer (the last layer always stays)"
      >
        🗑
      </button>
    </div>
  );
}

function ActiveLayerControls(props: {
  readonly active: NonNullable<EditorSession['layers'][number]>;
}): JSX.Element {
  const { active } = props;
  return (
    <div style={controlsStyle}>
      <label style={controlLabelStyle} title="Opacity of the active layer">
        Opacity
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(active.opacity * 100)}
          onChange={(e) =>
            updateSession((s) => setActiveLayerProps(s, { opacity: Number(e.target.value) / 100 }))
          }
          style={{ flex: 1 }}
          aria-label="Active layer opacity"
          title="Opacity of the active layer"
        />
      </label>
      <label
        style={controlLabelStyle}
        title="Blend mode: how this layer's ink meets the layers below"
      >
        Blend
        <select
          value={active.blend}
          onChange={(e) =>
            updateSession((s) => setActiveLayerProps(s, { blend: parseBlend(e.target.value) }))
          }
          style={selectStyle}
          aria-label="Active layer blend mode"
          title="Blend mode: how this layer's ink meets the layers below"
        >
          <option value="normal">Normal</option>
          <option value="multiply">Multiply</option>
          <option value="screen">Screen</option>
          <option value="overlay">Overlay</option>
          <option value="difference">Difference</option>
        </select>
      </label>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '45%',
  borderBottom: '1px solid var(--lf-border)',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  color: 'var(--lf-text)',
  borderBottom: '1px solid var(--lf-border)',
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 2,
  padding: 4,
};

const actionStyle: React.CSSProperties = {
  flex: 1,
  padding: '2px 0',
  fontSize: 12,
};

const controlsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '2px 8px 6px',
};

const controlLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};

const selectStyle: React.CSSProperties = {
  flex: 1,
  fontSize: 12,
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '2px 4px',
};

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
  padding: 4,
  gap: 2,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 2,
  alignItems: 'stretch',
};

const thumbStyle: React.CSSProperties = {
  width: THUMB_WIDTH,
  height: THUMB_HEIGHT,
  flexShrink: 0,
  alignSelf: 'center',
  borderRadius: 2,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-2)',
};

const eyeStyle: React.CSSProperties = {
  width: 30,
  padding: '2px 0',
  fontSize: 11,
};

const nameStyle: React.CSSProperties = {
  flex: 1,
  justifyContent: 'flex-start',
  textAlign: 'left',
  fontSize: 12,
  padding: '3px 8px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const activeNameStyle: React.CSSProperties = {
  background: 'var(--lf-bg-2)',
  fontWeight: 600,
};
