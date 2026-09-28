// Shared layout for the Settings window's sections.

export const settingsGroupStyle: React.CSSProperties = {
  display: 'grid',
  gap: 'var(--lf-space-2)',
  margin: 0,
  padding: 0,
  border: 'none',
};

export const settingsHeadingStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  fontSize: 'var(--lf-text-md)',
  fontWeight: 600,
};

export const settingsRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--lf-space-2)',
  cursor: 'pointer',
};

export const settingsFieldStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(140px, 1fr) 88px 24px',
  alignItems: 'center',
  gap: 'var(--lf-space-2)',
};

export const settingsNoteStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};

export const settingsLinkRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  alignItems: 'center',
  gap: 'var(--lf-space-3)',
};
