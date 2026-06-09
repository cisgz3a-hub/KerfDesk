import { useRef, useState } from 'react';
import type { ProjectOptimizationSettings } from '../../core/scene';
import { useDialogA11y } from '../common/use-dialog-a11y';

export function OptimizationSettingsDialog(props: {
  readonly settings: ProjectOptimizationSettings;
  readonly onCancel: () => void;
  readonly onApply: (patch: ProjectOptimizationSettings) => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [reduceTravelMoves, setReduceTravelMoves] = useState(props.settings.reduceTravelMoves);
  useDialogA11y(dialogRef, props.onCancel);
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="optimization-settings-title"
      tabIndex={-1}
      style={backdropStyle}
    >
      <form
        style={panelStyle}
        onSubmit={(event) => {
          event.preventDefault();
          props.onApply({ reduceTravelMoves });
        }}
      >
        <h2 id="optimization-settings-title" style={headingStyle}>
          Optimization Settings
        </h2>
        <label style={checkboxRowStyle}>
          <input
            name="reduceTravelMoves"
            type="checkbox"
            checked={reduceTravelMoves}
            onChange={(event) => setReduceTravelMoves(event.currentTarget.checked)}
          />
          <span>Reduce travel moves</span>
        </label>
        <p style={hintStyle}>
          Reorders cuts within each layer by proximity. Layer order stays controlled by Cuts /
          Layers.
        </p>
        <div style={actionsStyle}>
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit">OK</button>
        </div>
      </form>
    </div>
  );
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 20,
};
const panelStyle: React.CSSProperties = {
  width: 360,
  background: '#fff',
  border: '1px solid #ccc',
  borderRadius: 6,
  boxShadow: '0 12px 36px rgba(0, 0, 0, 0.25)',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  fontFamily: 'system-ui, sans-serif',
};
const headingStyle: React.CSSProperties = { margin: 0, fontSize: 18 };
const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};
const hintStyle: React.CSSProperties = {
  margin: 0,
  color: '#555',
  fontSize: 12,
  lineHeight: 1.4,
};
const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};
