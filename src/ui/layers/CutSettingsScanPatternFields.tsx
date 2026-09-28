// ADR-492: the direction an Image scans in, its cross-hatch, and the angle
// change between passes of an Image or a Fill. Shown only in Cut Settings; a
// form without these fields leaves the stored values untouched
// (cut-settings-draft.ts).

import { useState } from 'react';
import { normalizedScanAngleDeg } from '../../core/raster/raster-scan-frame';
import type { Layer } from '../../core/scene';
import { CutSettingsFillDirectionPreview } from './CutSettingsFillDirectionPreview';
import { MAX_PASS_ANGLE_STEP_DEG } from './cut-settings-draft';

export function ImageScanPatternFields(props: { readonly layer: Layer }): JSX.Element {
  // Folded into the field's range, so an angle stored from elsewhere (-45 is
  // 135) never blocks Apply.
  const [angleDeg, setAngleDeg] = useState(normalizedScanAngleDeg(props.layer.imageScanAngleDeg));
  const [crossHatch, setCrossHatch] = useState(props.layer.imageCrossHatch === true);
  return (
    <>
      <CutSettingsFillDirectionPreview
        angleDeg={angleDeg}
        crossHatch={crossHatch}
        ariaLabel="Image scan direction preview"
      />
      <Field label="Scan angle">
        <input
          name="imageScanAngleDeg"
          type="number"
          className="lf-input"
          min={0}
          max={180}
          step="any"
          value={angleDeg}
          onChange={(event) => setAngleDeg(Number(event.currentTarget.value))}
          style={numberStyle}
          aria-label="Cut settings image scan angle"
          title="Direction the image rows run, in degrees counter-clockwise from the X axis, as a Fill's scan angle. 0 scans along X; 90 scans along Y. Overscan and the bidirectional scan offset follow the rows."
        />
        <span className="lf-field-unit">deg</span>
      </Field>
      <Field label="Cross-hatch">
        <input
          name="imageCrossHatch"
          type="checkbox"
          className="lf-checkbox"
          checked={crossHatch}
          onChange={(event) => setCrossHatch(event.currentTarget.checked)}
          aria-label="Cut settings image cross-hatch"
          title="Scan the image a second time at 90 degrees on every pass, for deeper, more even engraving."
        />
      </Field>
      <PassAngleStepField layer={props.layer} />
    </>
  );
}

export function PassAngleStepField(props: { readonly layer: Layer }): JSX.Element {
  const stored = props.layer.passAngleStepDeg ?? 0;
  const stepDeg = Number.isFinite(stored)
    ? Math.max(-MAX_PASS_ANGLE_STEP_DEG, Math.min(MAX_PASS_ANGLE_STEP_DEG, stored))
    : 0;
  return (
    <Field label="Angle per pass">
      <input
        name="passAngleStepDeg"
        type="number"
        className="lf-input"
        min={-MAX_PASS_ANGLE_STEP_DEG}
        max={MAX_PASS_ANGLE_STEP_DEG}
        step="any"
        defaultValue={stepDeg}
        style={numberStyle}
        aria-label="Cut settings angle change per pass"
        title="With more than one pass, add this many degrees to the scan angle on every pass, so each pass crosses the last. 0 keeps every pass at the same angle."
      />
      <span className="lf-field-unit">deg</span>
    </Field>
  );
}

function Field(props: { readonly label: string; readonly children: React.ReactNode }): JSX.Element {
  return (
    <label className="lf-field">
      <span className="lf-field-label lf-field-label--md">{props.label}</span>
      <span style={controlStyle}>{props.children}</span>
    </label>
  );
}

const controlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const numberStyle: React.CSSProperties = { width: 96 };
