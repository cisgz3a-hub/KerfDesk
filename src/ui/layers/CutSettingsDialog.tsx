import { useRef, useState } from 'react';
import { MAX_RASTER_LINES_PER_MM } from '../../core/raster/raster-budget';
import {
  dpiToLinesPerMm,
  linesPerMmToDpi,
  MIN_RASTER_LINES_PER_MM,
} from '../../core/raster/raster-units';
import type { Layer, LayerMode } from '../../core/scene';
import { useDialogA11y } from '../common/use-dialog-a11y';
import { CutSettingsImageFields } from './CutSettingsImageFields';

type LayerPatch = Partial<Omit<Layer, 'id' | 'color'>>;

export function CutSettingsDialog(props: {
  readonly layer: Layer;
  readonly onCancel: () => void;
  readonly onApply: (patch: LayerPatch) => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<LayerMode>(props.layer.mode);
  const [dither, setDither] = useState<Layer['ditherAlgorithm']>(props.layer.ditherAlgorithm);
  const [imageLinesPerMm, setImageLinesPerMm] = useState(props.layer.linesPerMm);
  useDialogA11y(dialogRef, props.onCancel);
  const onSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    props.onApply(readLayerPatch(new FormData(form), props.layer));
  };
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Cut settings for ${props.layer.color}`}
      tabIndex={-1}
      style={backdropStyle}
    >
      <form onSubmit={onSubmit} style={panelStyle}>
        <Header layer={props.layer} />
        <CommonFields layer={props.layer} mode={mode} onModeChange={setMode} />
        {mode === 'fill' ? <FillFields layer={props.layer} /> : null}
        {mode === 'image' ? (
          <CutSettingsImageFields
            layer={props.layer}
            dither={dither}
            imageLinesPerMm={imageLinesPerMm}
            onDitherChange={setDither}
            onImageLinesPerMmChange={setImageLinesPerMm}
          />
        ) : null}
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

function Header({ layer }: { readonly layer: Layer }): JSX.Element {
  return (
    <header style={headerStyle}>
      <span style={{ ...swatchStyle, background: layer.color }} />
      <div>
        <h2 style={headingStyle}>Cut Settings</h2>
        <p style={subheadingStyle}>{layer.color}</p>
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
        <span style={unitStyle}>%</span>
      </Field>
      <Field label="Speed">
        <NumberInput name="speed" value={props.layer.speed} min={1} label="speed" />
        <span style={unitStyle}>mm/min</span>
      </Field>
      <Field label="Passes">
        <NumberInput name="passes" value={props.layer.passes} min={1} step={1} label="passes" />
      </Field>
      <Field label="Visible">
        <input name="visible" type="checkbox" defaultChecked={props.layer.visible} />
      </Field>
      <Field label="Output">
        <input name="output" type="checkbox" defaultChecked={props.layer.output} />
      </Field>
    </>
  );
}

function FillFields({ layer }: { readonly layer: Layer }): JSX.Element {
  return (
    <fieldset style={fieldsetStyle}>
      <legend style={legendStyle}>Fill</legend>
      <Field label="Hatch angle">
        <NumberInput name="hatchAngleDeg" value={layer.hatchAngleDeg} min={0} max={180} step={5} />
        <span style={unitStyle}>deg</span>
      </Field>
      <Field label="Hatch spacing">
        <NumberInput
          name="hatchSpacingMm"
          value={layer.hatchSpacingMm}
          min={0.05}
          max={10}
          step={0.05}
        />
        <span style={unitStyle}>mm</span>
      </Field>
      <Field label="Overscan">
        <NumberInput
          name="fillOverscanMm"
          value={layer.fillOverscanMm}
          min={0}
          max={25}
          step={0.5}
        />
        <span style={unitStyle}>mm</span>
      </Field>
      <Field label="Bidirectional">
        <input name="fillBidirectional" type="checkbox" defaultChecked={layer.fillBidirectional} />
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
    <label style={fieldStyle}>
      <span style={labelStyle}>{props.label}</span>
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
    fillBidirectional: data.has('fillBidirectional'),
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
  const allowed: ReadonlySet<string> = new Set([
    'threshold',
    'floyd-steinberg',
    'jarvis',
    'stucki',
    'atkinson',
    'burkes',
    'sierra3',
    'sierra2',
    'sierra-lite',
    'ordered',
    'grayscale',
  ]);
  return allowed.has(value) ? (value as Layer['ditherAlgorithm']) : 'floyd-steinberg';
}

function dotWidthCorrectionMax(linesPerMm: number): number {
  return 1 / Math.max(1, linesPerMm);
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};
const panelStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 6,
  padding: 16,
  minWidth: 420,
  maxWidth: 520,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  fontFamily: 'system-ui, sans-serif',
};
const headerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const swatchStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: 3,
  border: '1px solid #333',
};
const headingStyle: React.CSSProperties = { margin: 0, fontSize: 16 };
const subheadingStyle: React.CSSProperties = { margin: 0, color: '#666', fontSize: 12 };
const fieldStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const labelStyle: React.CSSProperties = { width: 112, color: '#444', fontSize: 13 };
const controlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const numberStyle: React.CSSProperties = { width: 96 };
const unitStyle: React.CSSProperties = { color: '#666', fontSize: 12 };
const fieldsetStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  margin: 0,
  padding: '10px 12px',
};
const legendStyle: React.CSSProperties = { color: '#374151', fontSize: 12, padding: '0 4px' };
const actionsStyle: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8 };
