// Shared inline styles for the Camera panel sections (one source so the
// sections read as one panel).

export const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
export const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  paddingBottom: 8,
  borderBottom: '1px solid var(--lf-border)',
};
export const noteStyle: React.CSSProperties = { color: 'var(--lf-text-faint)', margin: 0 };
export const errStyle: React.CSSProperties = { color: 'var(--lf-danger)', margin: 0 };
