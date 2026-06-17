export const stackStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
export const sectionStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: 10,
  background: 'var(--lf-bg-2)',
};
export const sectionHeadingStyle: React.CSSProperties = { margin: '0 0 8px', fontSize: 14 };
export const smallHeadingStyle: React.CSSProperties = { margin: '8px 0 4px', fontSize: 12 };
export const definitionGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '90px minmax(0, 1fr)',
  gap: '4px 10px',
  margin: 0,
};
export const catalogGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 10,
};
export const cardStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 10,
  background: 'var(--lf-bg)',
};
export const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  alignItems: 'center',
};
export const badgeStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '1px 4px',
};
export const mutedStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', margin: '4px 0' };
export const notesStyle: React.CSSProperties = { margin: '6px 0', paddingLeft: 18 };
export const buttonRowStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
export const errorStyle: React.CSSProperties = { color: 'var(--lf-danger-fg)' };
export const zoneGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(120px, 1fr) repeat(4, 72px) auto auto',
  gap: 8,
  alignItems: 'end',
};
export const firmwareGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(150px, 1fr) 90px 90px auto auto',
  gap: 8,
  alignItems: 'end',
};
export const inlineLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};
export const numberInputStyle: React.CSSProperties = { width: 68 };
