export const snapshotPanelStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  background: 'var(--lf-bg-input)',
  padding: 7,
  marginBottom: 8,
};
export const snapshotSummaryStyle: React.CSSProperties = { cursor: 'pointer', fontWeight: 700 };
export const snapshotNoticeStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  lineHeight: 1.35,
};
export const snapshotCaptureRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'end',
  gap: 6,
  flexWrap: 'wrap',
};
export const snapshotLabelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 3,
  flex: 1,
  minWidth: 190,
};
export const snapshotLabelInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
};
export const snapshotSlotGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: 6,
  marginTop: 7,
};
export const snapshotSlotStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: 6,
};
export const snapshotSlotDetailStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 11,
};
export const snapshotButtonRowStyle: React.CSSProperties = { display: 'flex', gap: 4 };
export const snapshotMutedStyle: React.CSSProperties = {
  color: 'var(--lf-text-faint)',
  fontStyle: 'italic',
};
export const snapshotStatusStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  margin: '6px 0',
};
export const snapshotCompareHeadingStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  flexWrap: 'wrap',
  margin: '8px 0 4px',
};
export const snapshotTableWrapStyle: React.CSSProperties = {
  overflow: 'auto',
  maxHeight: 240,
};
export const snapshotTableStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 680,
  borderCollapse: 'collapse',
  fontSize: 11,
};
export const snapshotCellStyle: React.CSSProperties = {
  padding: '4px 5px',
  borderBottom: '1px solid var(--lf-border)',
  textAlign: 'left',
  verticalAlign: 'top',
};
export const snapshotValueCellStyle: React.CSSProperties = {
  ...snapshotCellStyle,
  fontFamily: 'ui-monospace, Menlo, monospace',
  whiteSpace: 'nowrap',
};
export const snapshotSafetyNoteStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 11,
  marginBottom: 0,
};
