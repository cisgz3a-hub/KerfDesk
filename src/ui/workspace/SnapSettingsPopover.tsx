// SnapSettingsPopover — the snap options beside the canvas snap toggle
// (LightBurn gap LBG-F06): which kinds of point to snap to, the grid spacing,
// and the reach. Every change applies at once and is remembered in this
// browser; nothing here touches the project.

import { useCallback, useId, useRef, useState } from 'react';
import { AnchoredPopover } from '../common/AnchoredPopover';
import { NumberField } from '../common/NumberField';
import { Icon } from '../kit';
import { useUiStore } from '../state/ui-store';
import {
  MAX_SNAP_DISTANCE_PX,
  MAX_SNAP_GRID_MM,
  MIN_SNAP_DISTANCE_PX,
  MIN_SNAP_GRID_MM,
  type SnapSettings,
} from './snap-settings';

type SnapToggleKey = Extract<
  keyof SnapSettings,
  | 'snapToNodes'
  | 'snapToMidpoints'
  | 'snapToCenters'
  | 'snapToIntersections'
  | 'snapToGrid'
  | 'snapToObjects'
>;

// `glyph` is the marker the canvas draws for that kind (draw-snap-marker.ts).
const SNAP_TOGGLES: ReadonlyArray<{
  readonly key: SnapToggleKey;
  readonly name: string;
  readonly glyph: string;
  readonly title: string;
}> = [
  {
    key: 'snapToNodes',
    name: 'Nodes',
    glyph: '■',
    title: 'Snap to path nodes and curve end points.',
  },
  {
    key: 'snapToMidpoints',
    name: 'Midpoints',
    glyph: '△',
    title: 'Snap to the middle of each segment.',
  },
  {
    key: 'snapToCenters',
    name: 'Centres',
    glyph: '⊕',
    title: 'Snap to the centre of each shape, circle, ellipse and closed outline.',
  },
  {
    key: 'snapToIntersections',
    name: 'Intersections',
    glyph: '✕',
    title: 'Snap to where visible outlines cross.',
  },
  {
    key: 'snapToGrid',
    name: 'Grid',
    glyph: '+',
    title: 'Snap to grid lines within the snap distance.',
  },
  {
    key: 'snapToObjects',
    name: 'Alignment guides',
    glyph: '',
    title: 'While moving, line up box edges and centres with other artwork.',
  },
];

export function SnapSettingsButton(props: { readonly style: React.CSSProperties }): JSX.Element {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Snapping settings: snap kinds, grid spacing and snap distance"
        aria-label="Snap settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        style={props.style}
      >
        <Icon name="chevron-up" size={12} />
      </button>
      {open ? (
        <AnchoredPopover
          id={panelId}
          label="Snap settings"
          role="dialog"
          anchorRef={anchorRef}
          initialFocus="input"
          onClose={close}
        >
          <SnapSettingsPanel />
        </AnchoredPopover>
      ) : null}
    </>
  );
}

export function SnapSettingsPanel(): JSX.Element {
  const settings = useUiStore((state) => state.snapSettings);
  const setSnapSettings = useUiStore((state) => state.setSnapSettings);
  return (
    <div style={panelStyle}>
      <div style={headingStyle}>Snap to</div>
      {SNAP_TOGGLES.map((toggle) => (
        <label key={toggle.key} style={rowStyle} title={toggle.title}>
          <input
            type="checkbox"
            checked={settings[toggle.key]}
            onChange={(event) => setSnapSettings({ [toggle.key]: event.target.checked })}
            title={toggle.title}
            aria-label={toggle.name}
          />
          <span style={nameStyle}>{toggle.name}</span>
          <span style={glyphStyle} aria-hidden="true">
            {toggle.glyph}
          </span>
        </label>
      ))}
      <label style={fieldStyle}>
        <span>Grid spacing (mm)</span>
        <NumberField
          ariaLabel="Snap grid spacing in millimetres"
          title="Distance between grid lines, in millimetres. The canvas grid follows it."
          value={settings.gridMm}
          min={MIN_SNAP_GRID_MM}
          max={MAX_SNAP_GRID_MM}
          step={1}
          debounceMs={0}
          style={numberStyle}
          onCommit={(gridMm) => setSnapSettings({ gridMm })}
        />
      </label>
      <label style={fieldStyle}>
        <span>Snap distance (px)</span>
        <NumberField
          ariaLabel="Snap distance in screen pixels"
          title="How close the pointer must come, in screen pixels, so it feels the same at every zoom."
          value={settings.distancePx}
          min={MIN_SNAP_DISTANCE_PX}
          max={MAX_SNAP_DISTANCE_PX}
          step={1}
          debounceMs={0}
          style={numberStyle}
          onCommit={(distancePx) => setSnapSettings({ distancePx })}
        />
      </label>
      <p style={hintStyle}>
        Hold Alt while dragging or drawing to place freely. Ctrl also skips snapping when moving.
      </p>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 220,
  padding: 4,
};
const headingStyle: React.CSSProperties = { fontWeight: 600, marginBottom: 2 };
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
};
const nameStyle: React.CSSProperties = { flex: 1 };
const glyphStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', minWidth: 14 };
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginTop: 4,
};
const numberStyle: React.CSSProperties = { width: 72 };
const hintStyle: React.CSSProperties = {
  margin: '6px 0 0',
  maxWidth: 240,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
