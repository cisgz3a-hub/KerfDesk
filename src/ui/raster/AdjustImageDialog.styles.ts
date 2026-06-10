// Backdrop/panel/heading chrome now comes from the kit Dialog shell
// (ADR-047); only layout + preview-surface styles remain here.

export const headerStyle: React.CSSProperties = { marginBottom: 12 };
export const subheadingStyle: React.CSSProperties = { margin: '4px 0 0' };

export const previewGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 12,
  marginBottom: 14,
};

export const previewPaneStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 10,
  minHeight: 180,
};

export const previewHeadingStyle: React.CSSProperties = { margin: '0 0 8px', fontSize: 13 };

export const previewCanvasStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  maxHeight: 320,
  // Artwork preview surface stays LIGHT on the dark dialog (ADR-047) -
  // the engrave is judged against light material.
  background: '#f8f8f8',
  imageRendering: 'pixelated',
};

export const fieldsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(240px, 1fr))',
  gap: 10,
};

export const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '112px minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 8,
};

export const checkboxStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '112px auto',
  alignItems: 'center',
  gap: 8,
};

export const labelStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 13 };

// Width only - control chrome comes from .lf-input / .lf-select.
export const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
};

export const presetActionsStyle: React.CSSProperties = { display: 'flex', gap: 4 };
