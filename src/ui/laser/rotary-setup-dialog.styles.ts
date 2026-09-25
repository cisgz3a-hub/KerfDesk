// Shared inline styles for the Rotary Setup dialog and its field groups.

export const toggleStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
export const fieldRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '140px minmax(0, 1fr)',
  gap: 8,
  alignItems: 'center',
};
export const fieldLabelStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
export const fieldControlStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
export const segmentStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
};
export const segmentButtonStyle: React.CSSProperties = { borderRadius: 0, minWidth: 74 };
export const segmentActiveStyle: React.CSSProperties = {
  background: 'var(--lf-accent)',
  color: 'var(--lf-on-fill)',
};
export const numberStyle: React.CSSProperties = { width: 110 };
export const unitStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
export const panelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 8,
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  fontSize: 12,
};
export const previewStyle: React.CSSProperties = { ...panelStyle, gap: 3 };
export const hintStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  lineHeight: 1.45,
};
export const errorStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-danger-fg)',
  fontSize: 12,
};
export const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
};
