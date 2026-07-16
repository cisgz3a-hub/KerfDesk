export function Cnc3DPaneToggle({
  collapsed,
  onToggle,
}: {
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={collapsed ? 'lf-btn lf-btn--ghost' : undefined}
      style={collapsed ? collapsedExpandButtonStyle : undefined}
      onClick={onToggle}
      aria-label={collapsed ? 'Expand 3D result pane' : 'Collapse 3D result pane'}
      aria-expanded={!collapsed}
      title={
        collapsed
          ? 'Show the live 3D view. Canvas Focus is keeping the drawing area wide.'
          : 'Hide the 3D pane and use Canvas Focus.'
      }
    >
      {collapsed ? (
        <>
          <span aria-hidden="true">◂</span>
          <span style={verticalLabelStyle}>3D result</span>
        </>
      ) : (
        '▸'
      )}
    </button>
  );
}

const collapsedExpandButtonStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  padding: '8px 0',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: 8,
};
const verticalLabelStyle: React.CSSProperties = {
  writingMode: 'vertical-rl',
  transform: 'rotate(180deg)',
  whiteSpace: 'nowrap',
  fontSize: 12,
};
