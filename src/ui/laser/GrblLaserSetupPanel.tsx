/**
 * Legacy component retained for source compatibility. The unsafe fixed-value
 * setup button is gone; Machine Setup owns read/backup and verified writes.
 */
export function GrblLaserSetupPanel(_props: { readonly disabled: boolean }): JSX.Element {
  return (
    <p role="note" style={noteStyle}>
      Fixed-value GRBL setup batches are unavailable. Use the step-by-step Machine Setup flow to
      read and back up the controller, then confirm one supported setting at a time.
    </p>
  );
}

const noteStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  lineHeight: 1.4,
};
