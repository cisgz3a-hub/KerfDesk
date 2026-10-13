export function PreviewRenderStatus({ pending }: { readonly pending: boolean }): JSX.Element {
  // Keep the same footprint while worker frames arrive. Changing the dock's
  // height resizes the canvas, invalidates its bitmap and starts another render.
  return (
    <span
      className="lf-chip"
      role="status"
      aria-hidden={!pending}
      style={{ ...statusStyle, visibility: pending ? 'visible' : 'hidden' }}
    >
      Updating route view…
    </span>
  );
}

const statusStyle: React.CSSProperties = {
  display: 'inline-block',
  pointerEvents: 'none',
};
