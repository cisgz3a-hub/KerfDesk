import type { CSSProperties } from 'react';

export const containerStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
// Rows sit in a fixed-width side rail whose ancestors set overflow-x:hidden with
// no scrollbar (WorkspaceSidePanels / .lf-rail), so a non-wrapping row pushes its
// rightmost buttons (for example Start job) off-screen and unreachable. Wrap instead —
// mirrors OriginRow, the sibling block that already wraps correctly.
export const rowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 0 };
// Setup/origin actions render as equal-width columns instead of a wrapping flex
// row: wrapped rows break at arbitrary labels and leave ragged one-button lines
// at rail width, while a grid keeps every action the same size and position.
export const actionGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 6,
};
export const gridFullRowStyle: CSSProperties = { gridColumn: '1 / -1' };
export const primaryActionStyle: CSSProperties = {
  ...gridFullRowStyle,
  padding: '6px 10px',
  fontWeight: 600,
};
// Scannable group headers for the placement/origin clusters — text-only so the
// rail gains anatomy without adding more nested boxes.
export const sectionCaptionStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  color: 'var(--lf-text-faint)',
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
  // Sits on its own line under the Start row, hugging the trailing edge like a
  // status detail rather than competing with the action buttons.
  alignSelf: 'flex-end',
  fontVariantNumeric: 'tabular-nums',
};
export const runningSafetyStyle: CSSProperties = {
  color: 'var(--lf-warning-fg)',
  fontSize: 12,
  lineHeight: 1.3,
  // Take a full-width line of the wrapping row so this (often long) safety copy
  // always drops below the buttons and remains readable at narrow rail widths.
  flexBasis: '100%',
  minWidth: 0,
};
