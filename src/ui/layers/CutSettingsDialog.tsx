import { useState } from 'react';
import { MAX_RASTER_LINES_PER_MM } from '../../core/raster/raster-budget';
import {
  dpiToLinesPerMm,
  linesPerMmToDpi,
  MIN_RASTER_LINES_PER_MM,
} from '../../core/raster/raster-units';
import { DITHER_ALGORITHMS, type Layer, type LayerMode } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';
import { CutSettingsFillDensityFields } from './CutSettingsFillDensityFields';
import { CutSettingsImageFields } from './CutSettingsImageFields';

type LayerPatch = Partial<Omit<Layer, 'id' | 'color'>>;

export function CutSettingsDialog(props: {
  readonly layer: Layer;
  readonly onCancel: () => void;
  readonly onApply: (patch: LayerPatch) => void;
}): JSX.Element {
  const [mode, setMode] = useState<LayerMode>(props.layer.mode);
  const [dither, setDither] = useState<Layer['ditherAlgorithm']>(props.layer.ditherAlgorithm);
  const [fillLineIntervalMm, setFillLineIntervalMm] = useState(props.layer.hatchSpacingMm);
  const [imageLinesPerMm, setImageLinesPerMm] = useState(props.layer.linesPerMm);
  const onSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    props.onApply(readLayerPatch(new FormData(form), props.layer));
  };
  return (
    <Dialog
      onClose={props.onCancel}
      ariaLabel={`Cut settings for ${props.layer.color}`}
      as="form"
      onSubmit={onSubmit}
      size="md"
    >
      <Header layer={props.layer} />
      <CommonFields layer={props.layer} mode={mode} onModeChange={setMode} />
      {mode === 'fill' ? (
        <FillFields
          layer={props.layer}
          lineIntervalMm={fillLineIntervalMm}
          onLineIntervalMmChange={setFillLineIntervalMm}
        />
      ) : null}
      {mode === 'image' ? (
        <CutSettingsImageFields
          layer={props.layer}
          dither={dither}
          imageLinesPerMm={imageLinesPerMm}
          onDitherChange={setDither}
          onImageLinesPerMmChange={setImageLinesPerMm}
        />
      ) : null}
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary">
          OK
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Header({ layer }: { readonly layer: Layer }): JSX.Element {
  return (
    <header style={headerStyle}>
      {/* The swatch background is scene data (the layer color) — inline by
          the ADR-047 dynamic-styles policy. */}
      <span style={{ ...swatchStyle, background: layer.color }} />
      <div>
        <h2 className="lf-dialog-title">Cut Settings</h2>
        <p className="lf-subheading">{layer.color}</p>
      </div>
    </header>
  );
}

function CommonFields(props: {
  readonly layer: Layer;
  readonly mode: LayerMode;
  readonly onModeChange: (mode: LayerMode) => void;
}): JSX.Element {
  return (
    <>
      <Field label="Mode">
        <select
          name="mode"
          className="lf-select"
          value={props.mode}
          onChange={(event) => props.onModeChange(parseMode(event.target.value))}
          aria-label="Cut settings mode"
          autoFocus
        >
          <option value="line">Line</option>
          <option value="fill">Fill</option>
          <option value="image">Image</option>
        </select>
      </Field>
      <Field label="Power">
        <NumberInput name="power" value={props.layer.power} min={0} max={100} label="power" />
        <span className="lf-field-unit">%</span>
      </Field>
      <Field label="Speed">
        <NumberInput name="speed" value={props.layer.speed} min={1} label="speed" />
        <span className="lf-field-unit">mm/min</span>
      </Field>
      <Field label="Passes">
        <NumberInput name="passes" value={props.layer.passes} min={1} step={1} label="passes" />
      </Field>
      <Field label="Visible">
        <input
          name="visible"
          type="checkbox"
          className="lf-checkbox"
          defaultChecked={props.layer.visible}
        />
      </Field>
      <Field label="Output">
        <input
          name="output"
          type="checkbox"
          className="lf-checkbox"
          defaultChecked={props.layer.output}
        />
      </Field>
    </>
  );
}

function FillFields(props: {
  readonly layer: Layer;
  readonly lineIntervalMm: number;
  readonly onLineIntervalMmChange: (lineIntervalMm: number) => void;
}): JSX.Element {
  return (
    <fieldset className="lf-fieldset">
      <legend className="lf-legend">Fill</legend>
      <Field label="Scan angle">
        <NumberInput
          name="hatchAngleDeg"
          value={props.layer.hatchAngleDeg}
          min={0}
          max={180}
          step={5}
        />
        <span className="lf-field-unit">deg</span>
      </Field>
      <CutSettingsFillDensityFields
        lineIntervalMm={props.lineIntervalMm}
        onChange={props.onLineIntervalMmChange}
      />
      <Field label="Overscan">
        <NumberInput
          name="fillOverscanMm"
          value={props.layer.fillOverscanMm}
          min={0}
          max={25}
          step={0.5}
        />
        <span className="lf-field-unit">mm</span>
      </Field>
      <Field label="Bidirectional">
        <input
          name="fillBidirectional"
          type="checkbox"
          className="lf-checkbox"
          defaultChecked={props.layer.fillBidirectional}
        />
      </Field>
      <Field label="Cross-Hatch">
        <input
          name="fillCrossHatch"
          type="checkbox"
          className="lf-checkbox"
          defaultChecked={props.layer.fillCrossHatch}
          aria-label="Cut settings cross-hatch"
        />
      </Field>
    </fieldset>
  );
}

function NumberInput(props: {
  readonly name: string;
  readonly value: number;
  readonly min: number;
  readonly max?: number;
  readonly step?: number;
  readonly label?: string;
}): JSX.Element {
  return (
    <input
      name={props.name}
      type="number"
      className="lf-input"
      min={props.min}
      {...(props.max !== undefined ? { max: props.max } : {})}
      step={props.step ?? 1}
      defaultValue={props.value}
      style={numberStyle}
      aria-label={`Cut settings ${props.label ?? props.name}`}
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

function readLayerPatch(data: FormData, layer: Layer): LayerPatch {
  const mode = parseMode(String(data.get('mode') ?? layer.mode));
  const power = numberField(data, 'power', layer.power, 0, 100);
  const linesPerMm =
    mode === 'image'
      ? dpiToLinesPerMm(
          numberField(
            data,
            'imageDpi',
            linesPerMmToDpi(layer.linesPerMm),
            linesPerMmToDpi(MIN_RASTER_LINES_PER_MM),
            linesPerMmToDpi(MAX_RASTER_LINES_PER_MM),
          ),
        )
      : layer.linesPerMm;
  return {
    mode,
    power,
    minPower:
      mode === 'image'
        ? numberField(data, 'minPower', layer.minPower, 0, power)
        : Math.min(layer.minPower, power),
    speed: numberField(data, 'speed', layer.speed, 1, Number.POSITIVE_INFINITY),
    passes: Math.max(
      1,
      Math.floor(numberField(data, 'passes', layer.passes, 1, Number.POSITIVE_INFINITY)),
    ),
    visible: data.has('visible'),
    output: data.has('output'),
    hatchAngleDeg: numberField(data, 'hatchAngleDeg', layer.hatchAngleDeg, 0, 180),
    hatchSpacingMm: numberField(data, 'hatchSpacingMm', layer.hatchSpacingMm, 0.05, 10),
    fillOverscanMm: numberField(data, 'fillOverscanMm', layer.fillOverscanMm, 0, 25),
    fillBidirectional: mode === 'fill' ? data.has('fillBidirectional') : layer.fillBidirectional,
    fillCrossHatch: mode === 'fill' ? data.has('fillCrossHatch') : layer.fillCrossHatch,
    ditherAlgorithm: parseDither(String(data.get('ditherAlgorithm') ?? layer.ditherAlgorithm)),
    linesPerMm,
    dotWidthCorrectionMm:
      mode === 'image'
        ? numberField(
            data,
            'dotWidthCorrectionMm',
            layer.dotWidthCorrectionMm,
            0,
            dotWidthCorrectionMax(linesPerMm),
          )
        : layer.dotWidthCorrectionMm,
    negativeImage: mode === 'image' ? data.has('negativeImage') : layer.negativeImage,
    passThrough: mode === 'image' ? data.has('passThrough') : layer.passThrough,
  };
}

function numberField(
  data: FormData,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseFloat(String(data.get(name) ?? ''));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseMode(value: string): LayerMode {
  if (value === 'fill' || value === 'image') return value;
  return 'line';
}

function parseDither(value: string): Layer['ditherAlgorithm'] {
  return DITHER_ALGORITHMS.some((algorithm) => algorithm === value)
    ? (value as Layer['ditherAlgorithm'])
    : 'floyd-steinberg';
}

function dotWidthCorrectionMax(linesPerMm: number): number {
  return 1 / Math.max(1, linesPerMm);
}

const headerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const swatchStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: 3,
  border: '1px solid var(--lf-border-strong)',
};
const controlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const numberStyle: React.CSSProperties = { width: 96 };
