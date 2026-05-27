// StatusDisplay — Real-time GRBL state + machine position.
//
// Reads the latest status report from the laser store. The store polls `?`
// every 250 ms while connected and parses the `<state|MPos:...>` replies.

import { useLaserStore } from '../state/laser-store';

export function StatusDisplay(): JSX.Element {
  const report = useLaserStore((s) => s.statusReport);
  if (report === null) return <div style={dimStyle}>State: —</div>;
  const pos = report.mPos ?? report.wPos;
  const label = report.subState === null ? report.state : `${report.state}:${report.subState}`;
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
const dimStyle: React.CSSProperties = { fontStyle: 'italic', color: '#777' };
