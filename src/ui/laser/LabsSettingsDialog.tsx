import { Button, Dialog, DialogActions } from '../kit';
import {
  useExperimentalLaserFeatures,
  type ExperimentalLaserFeature,
  type ExperimentalLaserFeatures,
} from '../state/experimental-laser-features';

const FEATURE_ROWS: ReadonlyArray<{
  readonly id: ExperimentalLaserFeature;
  readonly label: string;
  readonly detail: string;
}> = [
  { id: 'rotary', label: 'Rotary setup', detail: 'Vector jobs on roller and chuck rotaries.' },
  {
    id: 'rotaryRaster',
    label: 'Rotary image engraving',
    detail: 'Raster output on a configured rotary. Requires Rotary setup.',
  },
  {
    id: 'lowPowerFire',
    label: 'Low-power Fire control',
    detail: 'Momentary positioning beam on approved diode profiles.',
  },
  {
    id: 'printAndCut',
    label: 'Print and Cut',
    detail: 'Two-point registration on homed, absolute-position machines.',
  },
  {
    id: 'cameraAlignmentV2',
    label: 'Camera alignment v2',
    detail: 'Experimental camera registration and validation workflow.',
  },
];

export function LabsSettingsDialog(props: { readonly onClose: () => void }): JSX.Element {
  const features = useExperimentalLaserFeatures((state) => state.features);
  const setFeature = useExperimentalLaserFeatures((state) => state.setFeature);
  const resetFeatures = useExperimentalLaserFeatures((state) => state.resetFeatures);
  return (
    <Dialog title="Labs" size="sm" onClose={props.onClose}>
      <p style={noticeStyle}>
        These machine workflows are still being hardware-validated. They are off by default and
        remain subject to normal device and safety checks.
      </p>
      <div style={listStyle}>
        {FEATURE_ROWS.map((row) => (
          <FeatureRow
            key={row.id}
            row={row}
            checked={featureChecked(features, row.id)}
            onChange={(checked) => setFeature(row.id, checked)}
          />
        ))}
      </div>
      <DialogActions>
        <Button onClick={resetFeatures}>Reset all</Button>
        <Button variant="primary" onClick={props.onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function FeatureRow(props: {
  readonly row: (typeof FEATURE_ROWS)[number];
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label style={rowStyle}>
      <input
        type="checkbox"
        className="lf-checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      <span>
        <strong style={labelStyle}>{props.row.label}</strong>
        <span style={detailStyle}>{props.row.detail}</span>
      </span>
    </label>
  );
}

function featureChecked(
  features: ExperimentalLaserFeatures,
  feature: ExperimentalLaserFeature,
): boolean {
  return features[feature];
}

const noticeStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-text-muted)', fontSize: 12 };
const listStyle: React.CSSProperties = { display: 'grid', gap: 8 };
const rowStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '18px 1fr', gap: 8 };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13 };
const detailStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 2,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
