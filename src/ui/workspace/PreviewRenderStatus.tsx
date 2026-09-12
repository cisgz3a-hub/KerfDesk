export function PreviewRenderStatus({
  pending,
}: {
  readonly pending: boolean;
}): JSX.Element | null {
  if (!pending) return null;
  return (
    <span className="lf-chip" role="status" style={statusStyle}>
      Updating route view…
    </span>
  );
}

const statusStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 56,
  left: 12,
  pointerEvents: 'none',
};
