// SetupStep — the calibration wizard's board description. Any printed
// checkerboard works; the operator enters its INNER-corner grid and the
// measured square size, then proceeds to capture.

import { Button, Field, NumberInput } from '../../kit';
import { useCameraWizardStore } from './camera-wizard-store';

const MIN_GRID = 3;
const MAX_GRID = 25;

export function SetupStep(): JSX.Element {
  const spec = useCameraWizardStore((s) => s.spec);
  const spacingMm = useCameraWizardStore((s) => s.spacingMm);
  const setSpec = useCameraWizardStore((s) => s.setSpec);
  const setSpacingMm = useCameraWizardStore((s) => s.setSpacingMm);
  const setStep = useCameraWizardStore((s) => s.setStep);

  const clampGrid = (value: number): number =>
    Math.max(MIN_GRID, Math.min(MAX_GRID, Math.round(value)));

  return (
    <div style={columnStyle}>
      <p style={copyStyle}>
        Print a checkerboard on stiff paper (a standard 9×6 board works well) and measure one
        square. Counts below are <strong>inner corners</strong> — where four squares meet — not
        squares.
      </p>
      <Field label="Corners across" labelWidth="md">
        <NumberInput
          aria-label="Inner corners across"
          value={spec.cols}
          min={MIN_GRID}
          max={MAX_GRID}
          onChange={(e) =>
            setSpec({ rows: spec.rows, cols: clampGrid(Number(e.currentTarget.value)) })
          }
        />
      </Field>
      <Field label="Corners down" labelWidth="md">
        <NumberInput
          aria-label="Inner corners down"
          value={spec.rows}
          min={MIN_GRID}
          max={MAX_GRID}
          onChange={(e) =>
            setSpec({ rows: clampGrid(Number(e.currentTarget.value)), cols: spec.cols })
          }
        />
      </Field>
      <Field label="Square size" labelWidth="md" unit="mm">
        <NumberInput
          aria-label="Checkerboard square size in millimeters"
          value={spacingMm}
          min={1}
          step={0.5}
          onChange={(e) => setSpacingMm(Math.max(1, Number(e.currentTarget.value)))}
        />
      </Field>
      <p style={hintStyle}>
        You will hold the board in front of the camera at several angles; capture is automatic when
        a new pose is detected.
      </p>
      <div style={navStyle}>
        <Button variant="primary" onClick={() => setStep('capture')}>
          Start capturing
        </Button>
      </div>
    </div>
  );
}

const columnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 };
const copyStyle: React.CSSProperties = { margin: 0 };
const hintStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-text-faint)', fontSize: 12 };
const navStyle: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end' };
