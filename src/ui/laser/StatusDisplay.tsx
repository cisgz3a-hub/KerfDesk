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
  if (report === null) return <div style={dimStyle}>State: —</div>;
  const pos = report.mPos ?? report.wPos;
  const label = report.subState === null ? report.state : `${report.state}:${report.subState}`;
  const customOrigin = hasCustomOrigin(wcoCache);
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
  background: '#fff',
  border: '1px solid #ddd',
  padding: 6,
  borderRadius: 4,
};
const stateRowStyle: React.CSSProperties = { color: '#1b5e20' };
const posRowStyle: React.CSSProperties = { color: '#212121' };
const feedRowStyle: React.CSSProperties = { color: '#555' };
// Default origin row is muted (it's the boring case). Custom origin gets
// the same accent red as the Stop button so the operator notices that
// their next job won't run at machine zero — important when picking up a
// previous workpiece or recovering after a power-cycle.
const originDefaultStyle: React.CSSProperties = { color: '#777' };
const originCustomStyle: React.CSSProperties = { color: '#c62828', fontWeight: 600 };
const dimStyle: React.CSSProperties = { fontStyle: 'italic', color: '#777' };
