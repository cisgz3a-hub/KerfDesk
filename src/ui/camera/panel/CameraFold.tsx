// CameraFold — a titled part of the Camera panel that opens on demand
// (ADR-663): tools used now and then stay one click away without filling the
// everyday panel. The browser keeps the open state, so a fold stays as the
// operator left it while the panel is open.

import type { CSSProperties, ReactNode } from 'react';

export function CameraFold(props: {
  readonly title: string;
  /** One short line after the title saying what the fold is for. */
  readonly hint?: string;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <details style={foldStyle} open={props.defaultOpen}>
      <summary style={summaryStyle} title={`Show or hide ${props.title}`}>
        <span style={titleStyle}>{props.title}</span>
        {props.hint === undefined ? null : <span style={hintStyle}>{props.hint}</span>}
      </summary>
      <div style={bodyStyle}>{props.children}</div>
    </details>
  );
}

const foldStyle: CSSProperties = {
  borderTop: '1px solid var(--lf-border)',
  paddingTop: 6,
};
// The summary stays a list item so it keeps the browser's open/closed marker.
const summaryStyle: CSSProperties = { cursor: 'pointer' };
const titleStyle: CSSProperties = { fontWeight: 600 };
const hintStyle: CSSProperties = { marginLeft: 6, fontSize: 12, color: 'var(--lf-text-faint)' };
const bodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  paddingTop: 8,
};
