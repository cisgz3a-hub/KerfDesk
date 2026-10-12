// SnapSettingsPopover — the snap options beside the canvas snap toggle
// (LightBurn gap LBG-F06): which kinds of point to snap to, the grid spacing,
// and the reach. Every change applies at once and is remembered in this
// browser; nothing here touches the project.

import { useCallback, useId, useRef, useState } from 'react';
import { AnchoredPopover } from '../common/AnchoredPopover';
import { NumberField } from '../common/NumberField';
import { Icon } from '../kit';
import { IconFrame } from '../kit/icon-frame';
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

// These small diagrams repeat the canvas markers (draw-snap-marker.ts).
const SNAP_TOGGLES: ReadonlyArray<{
  readonly key: SnapToggleKey;
  readonly name: string;
  readonly title: string;
}> = [
  {
    key: 'snapToNodes',
    name: 'Nodes',
    title: 'Snap to path nodes and curve end points.',
  },
  {
    key: 'snapToMidpoints',
    name: 'Midpoints',
    title: 'Snap to the middle of each segment.',
  },
  {
    key: 'snapToCenters',
    name: 'Centres',
    title: 'Snap to the centre of each shape, circle, ellipse and closed outline.',
  },
  {
    key: 'snapToIntersections',
    name: 'Intersections',
    title: 'Snap to where visible outlines cross.',
  },
  {
    key: 'snapToGrid',
    name: 'Grid',
    title: 'Snap to grid lines within the snap distance.',
  },
  {
    key: 'snapToObjects',
    name: 'Alignment guides',
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
            <SnapMarkerIcon kind={toggle.key} />
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

function SnapMarkerIcon({ kind }: { readonly kind: SnapToggleKey }): JSX.Element {
  return (
    <IconFrame size={16}>
      {kind === 'snapToNodes' ? (
        <rect x="8" y="8" width="8" height="8" fill="currentColor" />
      ) : null}
      {kind === 'snapToMidpoints' ? <path d="m12 5 8 14H4L12 5Z" /> : null}
      {kind === 'snapToCenters' ? (
        <>
          <circle cx="12" cy="12" r="7" />
          <path d="M12 8v8M8 12h8" />
        </>
      ) : null}
      {kind === 'snapToIntersections' ? <path d="m6 6 12 12M18 6 6 18" /> : null}
      {kind === 'snapToGrid' ? <path d="M12 5v14M5 12h14" /> : null}
      {kind === 'snapToObjects' ? (
        <>
          <rect x="4" y="5" width="7" height="6" rx="1" />
          <rect x="4" y="15" width="12" height="5" rx="1" />
          <path className="lf-icon-accent" d="M3 2v20" strokeDasharray="2 2" />
        </>
      ) : null}
    </IconFrame>
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
