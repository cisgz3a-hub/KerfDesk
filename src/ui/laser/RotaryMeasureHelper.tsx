// Strip measurement for Rotary Setup (ADR-373). A paper strip or flexible tape
// wrapped once round the part reads its circumference where the artwork goes,
// which calipers cannot do on a tapered cup or a soft sleeve. The strip's own
// thickness puts its centre line outside the surface, so the part's diameter
// is wrap length / π minus the strip thickness.

import { useState } from 'react';
import { rotaryDiameterFromWrapLengthMm } from '../../core/devices/rotary';
import { NumberField } from '../common/NumberField';
import { Button } from '../kit';
import {
  buttonRowStyle,
  hintStyle,
  numberStyle,
  panelStyle,
  unitStyle,
} from './rotary-setup-dialog.styles';
import { displayRotaryMm } from './rotary-setup-edit';
import { FieldRow } from './RotarySetupRows';

// Printer paper is about 0.1 mm; a steel or cloth tape measure is similar.
const DEFAULT_STRIP_THICKNESS_MM = 0.1;

export function RotaryMeasureHelper(props: {
  readonly diameterMm: number;
  readonly onUse: (diameterMm: number) => void;
}): JSX.Element {
  const [thicknessMm, setThicknessMm] = useState(DEFAULT_STRIP_THICKNESS_MM);
  // Starts at the wrap the current diameter would give, so nothing changes
  // until the operator enters what they measured.
  const [wrapMm, setWrapMm] = useState(() =>
    displayRotaryMm(Math.PI * (props.diameterMm + DEFAULT_STRIP_THICKNESS_MM)),
  );
  const diameterMm = displayRotaryMm(rotaryDiameterFromWrapLengthMm(wrapMm, thicknessMm));
  const usable = Number.isFinite(diameterMm) && diameterMm > 0;
  return (
    <div role="group" aria-label="Measure the object with a strip" style={panelStyle}>
      <p style={hintStyle}>
        Wrap a paper strip or flexible tape once around the part where the artwork goes, mark where
        it meets itself, lay it flat and measure between the marks.
      </p>
      <FieldRow label="Wrap length">
        <NumberField
          ariaLabel="Measured wrap length"
          value={wrapMm}
          positiveOnly
          step={0.1}
          debounceMs={0}
          onCommit={setWrapMm}
          style={numberStyle}
        />
        <span style={unitStyle}>mm</span>
      </FieldRow>
      <FieldRow label="Strip thickness">
        <NumberField
          ariaLabel="Strip thickness"
          value={thicknessMm}
          min={0}
          max={5}
          step={0.01}
          debounceMs={0}
          onCommit={setThicknessMm}
          style={numberStyle}
        />
        <span style={unitStyle}>mm</span>
      </FieldRow>
      <div style={buttonRowStyle}>
        <span>
          {usable
            ? `Diameter: Ø${diameterMm} mm`
            : 'The strip is thicker than this wrap length allows.'}
        </span>
        <Button disabled={!usable} onClick={() => props.onUse(diameterMm)}>
          Use this diameter
        </Button>
      </div>
    </div>
  );
}
