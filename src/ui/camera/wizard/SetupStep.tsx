// SetupStep — the calibration wizard's board description. The wizard can
// save a print-ready board (SVG sized in true millimetres, with a 100 mm
// scale bar); any printed checkerboard works — the operator enters its
// INNER-corner grid and the measured square size, then proceeds to capture.

import { usePlatform } from '../../app';
import { Button, Field, NumberInput } from '../../kit';
import { useToastStore } from '../../state/toast-store';
import { useCameraWizardStore } from './camera-wizard-store';
import { checkerboardFileName, checkerboardSvg } from './checkerboard-svg';

const MIN_GRID = 3;
const MAX_GRID = 25;

export function SetupStep(): JSX.Element {
  const platform = usePlatform();
  const pushToast = useToastStore((s) => s.pushToast);
  const spec = useCameraWizardStore((s) => s.spec);
  const spacingMm = useCameraWizardStore((s) => s.spacingMm);
  const setSpec = useCameraWizardStore((s) => s.setSpec);
  const setSpacingMm = useCameraWizardStore((s) => s.setSpacingMm);
  const setStep = useCameraWizardStore((s) => s.setStep);

  const clampGrid = (value: number): number =>
    Math.max(MIN_GRID, Math.min(MAX_GRID, Math.round(value)));

  const savePrintableBoard = async (): Promise<void> => {
    const target = await platform.pickFileForSave({
      suggestedName: checkerboardFileName(spec, spacingMm),
      extensions: ['.svg'],
    });
    if (target === null) return;
    await target.write(checkerboardSvg(spec, spacingMm));
    pushToast(
      'Checkerboard saved — print it at 100% scale, check the 100 mm bar with a ruler, and mount it on something stiff.',
      'success',
    );
  };

  return (
    <div style={columnStyle}>
      <p style={copyStyle}>
        Save and print the checkerboard below (or use any you have), mounted flat on stiff backing.
        Counts are <strong>inner corners</strong> — where four squares meet — not squares.
      </p>
      <div style={rowStyle}>
        <Button
          onClick={() => void savePrintableBoard()}
          title="Save a print-ready checkerboard (SVG at true scale with a 100 mm verification bar) matching the numbers below."
        >
          Save printable checkerboard…
        </Button>
      </div>
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
        Fixed machine camera? Move the BOARD, not the camera: place it on the bed, close the lid,
        hold still a few seconds (capture is automatic), then reposition and tilt it for the next
        pose.
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
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8 };
const hintStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-text-faint)', fontSize: 12 };
const navStyle: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end' };
