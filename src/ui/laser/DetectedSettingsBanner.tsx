// F-7: surface auto-detected machine settings from the `$$` dump.
// Shown after a successful connect when the collector produced a
// non-empty patch. Compares each detected value against the current
// device profile so the user can see whether anything's actually
// changing — Apply / Dismiss are both single-click.
//
// Single source of truth: detectedSettings lives on the laser store
// (transient, cleared on Apply or Dismiss). updateDeviceProfile is
// dispatched from applyDetectedSettings inside that store — this
// component just renders + dispatches.

import type { DeviceProfile } from '../../core/devices';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';

export function DetectedSettingsBanner(): JSX.Element | null {
  const detected = useLaserStore((s) => s.detectedSettings);
  const apply = useLaserStore((s) => s.applyDetectedSettings);
  const dismiss = useLaserStore((s) => s.dismissDetectedSettings);
  const current = useStore((s) => s.project.device);
  if (detected === null) return null;
  const rows = describePatch(detected, current);
  if (rows.length === 0) return null;
  return (
    <div style={panelStyle} role="region" aria-label="Detected machine settings">
      <strong style={titleStyle}>Detected machine settings</strong>
      <p style={hintStyle}>
        Your laser reported these values via <code>$$</code>. Apply them to keep time estimates and
        controller power settings in sync with the firmware.
      </p>
      <ul style={listStyle}>
        {rows.map((r) => (
          <li key={r.label} style={rowStyle}>
            <span style={rowLabelStyle}>{r.label}</span>
            <span style={rowValueStyle}>
              {r.changed ? (
                <>
                  <span style={oldStyle}>{r.oldText}</span>
                  <span aria-hidden style={arrowStyle}>
                    →
                  </span>
                  <span style={newStyle}>{r.newText}</span>
                </>
              ) : (
                <span style={unchangedStyle}>{r.newText} (no change)</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <div style={actionsStyle}>
        <button type="button" onClick={dismiss}>
          Dismiss
        </button>
        <button type="button" onClick={apply} style={primaryButtonStyle}>
          Apply
        </button>
      </div>
    </div>
  );
}

// Render a single field's before / after pair. Numeric formatting:
// integers for counts (maxFeed, maxPowerS), 3 decimals for mm fields
// (bed, junction deviation). Matches the rest of the laser UI.
type Row = {
  readonly label: string;
  readonly oldText: string;
  readonly newText: string;
  readonly changed: boolean;
};

export function describePatch(
  patch: Partial<DeviceProfile>,
  current: DeviceProfile,
): ReadonlyArray<Row> {
  const rows: Row[] = [];
  pushNumericRow(rows, 'Bed width', patch.bedWidth, current.bedWidth, formatMm);
  pushNumericRow(rows, 'Bed height', patch.bedHeight, current.bedHeight, formatMm);
  pushNumericRow(rows, 'Max feed', patch.maxFeed, current.maxFeed, formatFeed);
  pushNumericRow(rows, 'Max power (S)', patch.maxPowerS, current.maxPowerS, formatInt);
  pushNumericRow(rows, 'Min power (S)', patch.minPowerS, current.minPowerS, formatInt);
  pushBooleanRow(
    rows,
    'Laser mode ($32)',
    patch.laserModeEnabled,
    current.laserModeEnabled,
    formatLaserMode,
  );
  pushNumericRow(rows, 'Acceleration', patch.accelMmPerSec2, current.accelMmPerSec2, formatAccel);
  pushNumericRow(
    rows,
    'Junction deviation',
    patch.junctionDeviationMm,
    current.junctionDeviationMm,
    formatMm,
  );
  return rows;
}

function pushBooleanRow(
  rows: Row[],
  label: string,
  next: boolean | undefined,
  prev: boolean,
  format: (value: boolean) => string,
): void {
  if (next === undefined) return;
  rows.push({
    label,
    oldText: format(prev),
    newText: format(next),
    changed: next !== prev,
  });
}

function pushNumericRow(
  rows: Row[],
  label: string,
  next: number | undefined,
  prev: number,
  format: (n: number) => string,
): void {
  if (next === undefined) return;
  rows.push({
    label,
    oldText: format(prev),
    newText: format(next),
    changed: !numbersClose(next, prev),
  });
}

// Treat values within 0.1% (or 0.001 absolute) as equal — avoids the
// banner shouting "0.010 → 0.010" when the firmware reports the same
// junction deviation but as a string with extra zeros.
function numbersClose(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  if (diff < 0.001) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1);
  return diff / denom < 0.001;
}

function formatMm(n: number): string {
  return `${n.toFixed(3)} mm`;
}
function formatFeed(n: number): string {
  return `${Math.round(n)} mm/min`;
}
function formatInt(n: number): string {
  return `${Math.round(n)}`;
}
function formatAccel(n: number): string {
  return `${Math.round(n)} mm/s²`;
}
function formatLaserMode(enabled: boolean): string {
  return enabled ? 'Enabled' : 'Disabled';
}

const panelStyle: React.CSSProperties = {
  border: '1px solid var(--lf-accent)',
  background: 'var(--lf-tint-info)',
  padding: 8,
  borderRadius: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};
const titleStyle: React.CSSProperties = { fontSize: 13, color: 'var(--lf-accent-fg)' };
const hintStyle: React.CSSProperties = {
  margin: '2px 0 4px 0',
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};
const listStyle: React.CSSProperties = { margin: 0, padding: 0, listStyle: 'none', fontSize: 12 };
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
  padding: '2px 0',
};
const rowLabelStyle: React.CSSProperties = { width: 130, color: 'var(--lf-text-muted)' };
const rowValueStyle: React.CSSProperties = {
  display: 'inline-flex',
  gap: 4,
  alignItems: 'baseline',
};
const oldStyle: React.CSSProperties = {
  color: 'var(--lf-text-faint)',
  textDecoration: 'line-through',
};
const arrowStyle: React.CSSProperties = { color: 'var(--lf-text-faint)' };
const newStyle: React.CSSProperties = { color: 'var(--lf-text)', fontWeight: 600 };
const unchangedStyle: React.CSSProperties = { color: 'var(--lf-text-faint)' };
const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 6,
  marginTop: 4,
};
const primaryButtonStyle: React.CSSProperties = {
  background: 'var(--lf-accent)',
  color: 'var(--lf-on-fill)',
  border: 'none',
  padding: '4px 10px',
  borderRadius: 3,
  cursor: 'pointer',
};
