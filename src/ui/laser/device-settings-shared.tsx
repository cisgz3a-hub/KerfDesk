// device-settings-shared — small primitives (Row + style tokens) reused
// across the DeviceSettings sub-components. Extracted to break circular
// imports between DeviceSettings.tsx (the parent) and its split-out
// children (AutofocusEditor, PlannerAdvanced).

export function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <span style={fieldStyle}>{children}</span>
    </div>
  );
}

export const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
};
export const labelStyle: React.CSSProperties = { width: 80, color: '#444' };
export const fieldStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flex: 1,
};
export const numInputStyle: React.CSSProperties = { width: 64 };
export const unitStyle: React.CSSProperties = { fontSize: 11, color: '#666' };
export const inlineCodeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, monospace',
  background: '#eee',
  padding: '0 3px',
  borderRadius: 2,
  fontStyle: 'normal',
};
