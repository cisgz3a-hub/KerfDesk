export const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.35)',
  zIndex: 30,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export const panelStyle: React.CSSProperties = {
  width: 'min(900px, calc(100vw - 40px))',
  maxHeight: 'calc(100vh - 40px)',
  overflow: 'auto',
  background: '#fff',
  border: '1px solid #bbb',
  borderRadius: 6,
  boxShadow: '0 12px 32px rgba(0,0,0,0.24)',
  padding: 16,
};

export const headerStyle: React.CSSProperties = { marginBottom: 12 };
export const headingStyle: React.CSSProperties = { margin: 0, fontSize: 18 };
export const subheadingStyle: React.CSSProperties = { margin: '4px 0 0', color: '#555' };

export const previewGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 12,
  marginBottom: 14,
};

export const previewPaneStyle: React.CSSProperties = {
  border: '1px solid #d0d0d0',
  borderRadius: 6,
  padding: 10,
  minHeight: 180,
};

export const previewHeadingStyle: React.CSSProperties = { margin: '0 0 8px', fontSize: 13 };

export const previewCanvasStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  maxHeight: 320,
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

export const labelStyle: React.CSSProperties = { color: '#333', fontSize: 13 };

export const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid #bbb',
  borderRadius: 4,
  padding: '5px 7px',
};

export const presetActionsStyle: React.CSSProperties = { display: 'flex', gap: 4 };

export const unitStyle: React.CSSProperties = { color: '#666', fontSize: 12 };

export const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 16,
};
