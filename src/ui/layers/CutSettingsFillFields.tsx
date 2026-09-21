import { useState } from 'react';
import type { Layer } from '../../core/scene';
import { CutSettingsFillDirectionPreview } from './CutSettingsFillDirectionPreview';
import { CutSettingsFillDensityFields } from './CutSettingsFillDensityFields';
import { genericRunwayFallbackText } from './fill-overscan-fallback';

export function CutSettingsFillFields(props: {
  readonly layer: Layer;
  readonly lineIntervalMm: number;
  readonly onLineIntervalMmChange: (lineIntervalMm: number) => void;
}): JSX.Element {
  const [fillStyle, setFillStyle] = useState(props.layer.fillStyle);
  const [hatchAngleDeg, setHatchAngleDeg] = useState(props.layer.hatchAngleDeg);
  const [fillCrossHatch, setFillCrossHatch] = useState(props.layer.fillCrossHatch);
  const [fillOverscanMm, setFillOverscanMm] = useState(props.layer.fillOverscanMm);
  return (
    <fieldset className="lf-fieldset lf-cut-settings-group">
      <legend className="lf-legend">Fill detail</legend>
      <p className="lf-laser-help">
        Choose a pattern, then adjust the spacing and direction of the engraved lines.
      </p>
      <CutSettingsFillDirectionPreview angleDeg={hatchAngleDeg} crossHatch={fillCrossHatch} />
      <Field label="Style">
        <select
          name="fillStyle"
          className="lf-select"
          value={fillStyle}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === 'scanline' || value === 'offset' || value === 'island') {
              setFillStyle(value);
            }
          }}
          aria-label="Cut settings fill style"
          title="Choose Scanline, Follow Shape, or Island Fill for filled paths."
        >
          <option value="scanline">Scanline</option>
          <option value="offset">Follow Shape</option>
          <option value="island">Island Fill</option>
        </select>
      </Field>
      <Field label="Scan angle">
        <NumberInput
          name="hatchAngleDeg"
          value={hatchAngleDeg}
          min={0}
          max={180}
          step={5}
          onChange={setHatchAngleDeg}
        />
        <span className="lf-field-unit">deg</span>
      </Field>
      <CutSettingsFillDensityFields
        lineIntervalMm={props.lineIntervalMm}
        onChange={props.onLineIntervalMmChange}
      />
      <p className="lf-laser-help">
        Line interval and lines per inch describe the same density. Closer lines create a denser
        fill.
      </p>
      <FillOverscanField
        fillStyle={fillStyle}
        value={fillOverscanMm}
        onChange={setFillOverscanMm}
      />
      <FillScanDirectionFields
        layer={props.layer}
        crossHatch={fillCrossHatch}
        onCrossHatchChange={setFillCrossHatch}
      />
    </fieldset>
  );
}

function FillScanDirectionFields(props: {
  readonly layer: Layer;
  readonly crossHatch: boolean;
  readonly onCrossHatchChange: (enabled: boolean) => void;
}): JSX.Element {
  return (
    <>
      <Field label="Scan both ways">
        <input
          name="fillBidirectional"
          type="checkbox"
          className="lf-checkbox"
          defaultChecked={props.layer.fillBidirectional}
          title="Scan fill lines in both directions to reduce travel time."
        />
      </Field>
      <Field label="Cross-hatch">
        <input
          name="fillCrossHatch"
          type="checkbox"
          className="lf-checkbox"
          checked={props.crossHatch}
          onChange={(event) => props.onCrossHatchChange(event.currentTarget.checked)}
          aria-label="Cut settings cross-hatch"
          title="Add a second fill pass at 90 degrees for denser engraving."
        />
      </Field>
      <details className="lf-cut-settings-disclosure">
        <summary>Calibration override</summary>
        <div className="lf-cut-settings-disclosure__body">
          <p className="lf-laser-help">
            Allow bidirectional scanning without calibrated offsets. Edges may appear doubled or
            blurred.
          </p>
          <ExpertOverrideField enabled={props.layer.allowUncalibratedBidirectionalScan === true} />
        </div>
      </details>
    </>
  );
}

function FillOverscanField(props: {
  readonly fillStyle: Layer['fillStyle'];
  readonly value: number;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  return (
    <Field label="Overscan">
      <NumberInput
        name="fillOverscanMm"
        value={props.value}
        min={0}
        max={25}
        step={0.5}
        onChange={props.onChange}
      />
      <span className="lf-field-unit">mm</span>
      {props.fillStyle === 'scanline' && props.value <= 0 ? (
        <span style={FALLBACK_STYLE}>{genericRunwayFallbackText(props.value)}</span>
      ) : null}
    </Field>
  );
}

function ExpertOverrideField(props: { readonly enabled: boolean }): JSX.Element {
  return (
    <Field label="Allow uncalibrated scans">
      <input
        name="allowUncalibratedBidirectionalScan"
        type="checkbox"
        className="lf-checkbox"
        defaultChecked={props.enabled}
        title="Allow uncalibrated bidirectional scanning, which can double or blur edges. Profiles requiring verified offsets still use one-way scanning while a saved table is marked pending."
      />
    </Field>
  );
}

function NumberInput(props: {
  readonly name: string;
  readonly value: number;
  readonly min: number;
  readonly max?: number;
  readonly step?: number;
  readonly label?: string;
  readonly onChange?: (value: number) => void;
}): JSX.Element {
  return (
    <input
      name={props.name}
      type="number"
      className="lf-input"
      min={props.min}
      {...(props.max !== undefined ? { max: props.max } : {})}
      step={props.step ?? 1}
      {...(props.onChange !== undefined
        ? {
            value: props.value,
            onChange: (event) => props.onChange?.(Number(event.currentTarget.value)),
          }
        : { defaultValue: props.value })}
      style={numberStyle}
      aria-label={`Cut settings ${props.label ?? props.name}`}
      title={`Set cut settings ${props.label ?? props.name}.`}
    />
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
const FALLBACK_STYLE: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 11,
};
