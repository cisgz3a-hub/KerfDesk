import type { CSSProperties } from 'react';

export const containerStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
// Rows sit in a fixed-width side rail whose ancestors set overflow-x:hidden with
// no scrollbar (WorkspaceSidePanels / .lf-rail), so a non-wrapping row pushes its
// rightmost buttons (Start job, Abort) off-screen and unreachable. Wrap instead —
// mirrors OriginRow.originRowStyle, the sibling row that already wraps correctly.
export const rowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 0 };
export const stopBtnStyle: CSSProperties = {
  background: 'var(--lf-danger)',
  color: 'var(--lf-on-fill)',
};
export const progressContainerStyle: CSSProperties = {
  position: 'relative',
  background: 'var(--lf-bg-input)',
  height: 18,
  borderRadius: 3,
  overflow: 'hidden',
};
export const progressFillStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 0,
  background: 'var(--lf-accent)',
  transition: 'width 100ms linear',
};
export const progressLabelStyle: CSSProperties = {
  position: 'relative',
  textAlign: 'center',
  fontSize: 11,
  lineHeight: '18px',
  color: 'var(--lf-text)',
};
export const estimateStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  alignSelf: 'center',
  fontVariantNumeric: 'tabular-nums',
};
export const runningSafetyStyle: CSSProperties = {
  color: 'var(--lf-warning-fg)',
  fontSize: 12,
  lineHeight: 1.3,
  // Take a full-width line of the wrapping row so this (often long) safety copy
  // always drops below the buttons instead of competing with the safety-critical
  // Abort button for horizontal space and pushing it off the rail.
  flexBasis: '100%',
  minWidth: 0,
};
