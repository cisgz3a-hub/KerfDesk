// LaserLog — rolling console of lines received from the GRBL controller.
//
// Reads `state.log` from the laser store, which already accumulates every
// line classified by `classifyResponse` plus the raw originals. Colorizes by
// prefix so error / alarm responses stand out from the periodic `<…>` status
// stream. Status lines are hidden by default (one every 250 ms — would drown
// out everything else) with a toggle.

import { useState, useRef, useEffect } from 'react';
import { useLaserStore } from '../state/laser-store';

export function LaserLog(): JSX.Element {
  const log = useLaserStore((s) => s.log);
  const [showStatus, setShowStatus] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the newest line as it arrives, mirroring how a serial
  // terminal feels — but only if the user is already pinned to the bottom.
  // Otherwise they're scrolled back reading something and we shouldn't jump.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }, [log]);

  const filtered = showStatus ? log : log.filter((line) => !isStatusLine(line));

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span style={titleStyle}>Log</span>
        <label style={toggleStyle}>
          <input
            type="checkbox"
            checked={showStatus}
            onChange={(e) => setShowStatus(e.target.checked)}
          />
          Show status polls
        </label>
      </div>
      <div ref={scrollRef} style={scrollStyle} role="log" aria-live="polite">
        {filtered.length === 0 ? (
          <div style={emptyStyle}>(connect to a controller to see responses)</div>
        ) : (
          filtered.map((line, i) => (
            <div key={`${i}-${line}`} style={styleForLine(line)}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function isStatusLine(line: string): boolean {
  return line.startsWith('<') && line.endsWith('>');
}

function styleForLine(line: string): React.CSSProperties {
  const trimmed = line.trim();
  if (trimmed.startsWith('error:')) return errorStyle;
  if (trimmed.startsWith('ALARM:')) return alarmStyle;
  if (trimmed === 'ok') return okStyle;
  if (trimmed.startsWith('[')) return messageStyle;
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return statusStyle;
  if (/^Grbl /i.test(trimmed)) return welcomeStyle;
  return defaultStyle;
}

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  background: 'var(--lf-bg-input)',
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 11,
  minHeight: 0,
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '4px 6px',
  borderBottom: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-0)',
};
const titleStyle: React.CSSProperties = { fontWeight: 600 };
const toggleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 10,
  color: 'var(--lf-text-muted)',
  cursor: 'pointer',
};
const scrollStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '4px 6px',
  maxHeight: 160,
  minHeight: 80,
};
const emptyStyle: React.CSSProperties = { color: 'var(--lf-text-faint)', fontStyle: 'italic' };

const defaultStyle: React.CSSProperties = { color: 'var(--lf-text)', whiteSpace: 'pre-wrap' };
const okStyle: React.CSSProperties = { ...defaultStyle, color: 'var(--lf-text-faint)' };
const errorStyle: React.CSSProperties = {
  ...defaultStyle,
  color: 'var(--lf-danger-fg)',
  fontWeight: 600,
};
const alarmStyle: React.CSSProperties = {
  ...defaultStyle,
  color: '#fff',
  background: 'var(--lf-danger)',
};
const welcomeStyle: React.CSSProperties = { ...defaultStyle, color: 'var(--lf-accent-fg)' };
const messageStyle: React.CSSProperties = { ...defaultStyle, color: 'var(--lf-trace-fg)' };
const statusStyle: React.CSSProperties = { ...defaultStyle, color: 'var(--lf-text-faint)' };
