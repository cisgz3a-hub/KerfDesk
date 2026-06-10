import { useState } from 'react';
import type { ProjectOptimizationSettings } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';

export function OptimizationSettingsDialog(props: {
  readonly settings: ProjectOptimizationSettings;
  readonly onCancel: () => void;
  readonly onApply: (patch: ProjectOptimizationSettings) => void;
}): JSX.Element {
  const [reduceTravelMoves, setReduceTravelMoves] = useState(props.settings.reduceTravelMoves);
  return (
    <Dialog
      onClose={props.onCancel}
      title="Optimization Settings"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onApply({ reduceTravelMoves });
      }}
      size="sm"
    >
      <label style={checkboxRowStyle}>
        <input
          name="reduceTravelMoves"
          type="checkbox"
          className="lf-checkbox"
          checked={reduceTravelMoves}
          onChange={(event) => setReduceTravelMoves(event.currentTarget.checked)}
        />
        <span>Reduce travel moves</span>
      </label>
      <p style={hintStyle}>
        Reorders cuts within each layer by proximity. Layer order stays controlled by Cuts / Layers.
      </p>
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary">
          OK
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};
const hintStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  lineHeight: 1.4,
};
