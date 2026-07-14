// StatusDisplay — Real-time GRBL state + machine position + work origin.
//
// Reads the latest status report from the laser store. The store polls `?`
// every 250 ms while connected and parses the `<state|MPos:...>` replies.
//
// Work-origin row (F.3) reads `wcoCache` — the LAST-SEEN WCO across
// frames — never `statusReport.wco`, which is null on most frames
// because GRBL only emits WCO every Nth report. Reading raw `wco` here
// would flicker between "machine 0,0" and "custom" 29 frames out of 30.

import { hasCustomOrigin, useLaserStore } from '../state/laser-store';

export function StatusDisplay(): JSX.Element {
  const report = useLaserStore((s) => s.statusReport);
  const wcoCache = useLaserStore((s) => s.wcoCache);
  const workOriginActive = useLaserStore((s) => s.workOriginActive);
  if (report === null) return <div style={dimStyle}>State: —</div>;
  const pos = report.mPos ?? report.wPos;
  const label = report.subState === null ? report.state : `${report.state}:${report.subState}`;
  // workOriginActive covers a deliberately-set origin whose offset happens to be
  // zero (hand-set at machine 0,0 on a no-homing machine) — hasCustomOrigin(wco)
  // alone would render that as "machine 0,0" and read as if Set origin failed.
  const customOrigin = workOriginActive || hasCustomOrigin(wcoCache);
  return (
    <div style={panelStyle}>
      <div style={stateRowStyle}>
        <strong>State:</strong> {label}
      </div>
      {pos !== null && (
        <div style={posRowStyle}>
          <strong>MPos:</strong> X {pos.x.toFixed(3)} Y {pos.y.toFixed(3)} Z {pos.z.toFixed(3)}
        </div>
      )}
      <div style={customOrigin ? originCustomStyle : originDefaultStyle}>
        <strong>Origin:</strong>{' '}
        {customOrigin && wcoCache !== null
          ? `X ${wcoCache.x.toFixed(3)} Y ${wcoCache.y.toFixed(3)} (custom)`
          : 'machine 0,0'}
      </div>
      {report.feed !== null && (
        <div style={feedRowStyle}>
          <strong>F:</strong> {report.feed} mm/min <strong>S:</strong> {report.spindle ?? 0}
        </div>
      )}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 12,
  background: 'var(--lf-bg-input)',
  border: '1px solid var(--lf-border)',
  padding: 6,
  borderRadius: 4,
};
const stateRowStyle: React.CSSProperties = { color: 'var(--lf-success-fg)' };
const posRowStyle: React.CSSProperties = { color: 'var(--lf-text)' };
const feedRowStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
// Default origin row is muted (it's the boring case). Custom origin gets
// the same accent red as the Stop button so the operator notices that
// their next job won't run at machine zero — important when picking up a
// previous workpiece or recovering after a power-cycle.
const originDefaultStyle: React.CSSProperties = { color: 'var(--lf-text-faint)' };
const originCustomStyle: React.CSSProperties = { color: 'var(--lf-danger-fg)', fontWeight: 600 };
const dimStyle: React.CSSProperties = { fontStyle: 'italic', color: 'var(--lf-text-faint)' };
