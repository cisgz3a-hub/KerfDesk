// Presentational controls; trace requests and commit ownership stay in the dialog.
import type { RasterImage } from '../../core/scene';
import { TRACE_PRESETS } from '../../core/trace';
import { Button, DialogActions as KitDialogActions } from '../kit';

export const VISIBLE_TRACE_PRESET_NAMES = [
  'Line Art',
  'Smooth',
  'Sharp',
  'Centerline',
  'Edge Detection',
] as const;
export const DEFAULT_TRACE_PRESET_NAME = 'Line Art';
// CNC starts on Smooth; every other preset remains available.
export const CNC_TRACE_PRESET_NAME = 'Smooth';
export type TraceFillStyle = 'scanline' | 'offset' | 'island';
export type TraceOutput = 'raster' | 'vector';

const PRESET_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'Line Art':
    'A balanced start for logos, lettering and drawings. Automatic detection keeps pale details.',
  Smooth: 'Clean curves and quieter outlines for rough or noisy artwork. Very fine gaps may close.',
  Sharp:
    'Crisp corners, fine lines and tiny marks. Keeps more detail, including small source specks.',
  Centerline:
    'One path along the middle of each stroke. Useful for single-stroke lettering and linework.',
  'Edge Detection':
    'Outlines around dark artwork and local detail. Neighbouring dark tones may merge.',
};

export function TraceDialogHeader(props: {
  readonly source: RasterImage;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <header className="lf-trace-dialog-header">
      <div className="lf-trace-dialog-heading">
        <h2 className="lf-dialog-title">Trace Image</h2>
        <p className="lf-trace-source">
          <span title={props.source.source}>{props.source.source}</span>
          <span>
            {props.source.pixelWidth} × {props.source.pixelHeight} px
          </span>
        </p>
      </div>
      <button
        type="button"
        className="lf-btn lf-trace-close"
        aria-label="Close trace image"
        onClick={props.onClose}
      >
        <span aria-hidden="true">×</span>
      </button>
    </header>
  );
}

export function PresetPicker(props: {
  readonly machineKind: 'laser' | 'cnc';
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly hasOverrides?: boolean;
}): JSX.Element {
  return (
    <section className="lf-trace-preset" aria-label="Trace style">
      <div className="lf-trace-section-heading">
        <h3>Trace style</h3>
        {props.hasOverrides ? <span className="lf-trace-edited">Settings edited</span> : null}
      </div>
      <label className="lf-trace-preset-select">
        <span>Preset</span>
        <select
          className="lf-select"
          aria-label="Trace preset"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        >
          {VISIBLE_TRACE_PRESET_NAMES.filter((name) => TRACE_PRESETS[name] !== undefined).map(
            (name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ),
          )}
        </select>
      </label>
      <div className="lf-trace-preset-description">
        <span>{props.value === 'Centerline' ? 'Single paths' : 'Closed outlines'}</span>
        <p>{PRESET_DESCRIPTIONS[props.value]}</p>
      </div>
      {props.machineKind === 'cnc' ? (
        <p className="lf-trace-hint">
          Smooth is the CNC starting preset. All styles are available.
        </p>
      ) : null}
      {props.hasOverrides ? (
        <p className="lf-trace-hint">
          Your adjustments stay when you switch styles. Reset trace settings to use the selected
          preset’s defaults.
        </p>
      ) : null}
    </section>
  );
}

export function TraceOutputFields(props: {
  readonly machineKind: 'laser' | 'cnc';
  readonly traceOutput: TraceOutput;
  readonly onTraceOutputChange: (output: TraceOutput) => void;
  readonly supportsFillStyle: boolean;
  readonly traceFillStyle: TraceFillStyle;
  readonly onTraceFillStyleChange: (style: TraceFillStyle) => void;
}): JSX.Element {
  const showFillStyle =
    props.machineKind === 'laser' && props.traceOutput === 'vector' && props.supportsFillStyle;
  return (
    <>
      {props.machineKind === 'cnc' ? (
        <CncTraceHint />
      ) : (
        <TraceOutputPicker value={props.traceOutput} onChange={props.onTraceOutputChange} />
      )}
      {showFillStyle ? (
        <TraceFillStylePicker
          value={props.traceFillStyle}
          onChange={props.onTraceFillStyleChange}
        />
      ) : null}
    </>
  );
}

export function TraceOutputPicker(props: {
  readonly value: TraceOutput;
  readonly onChange: (next: TraceOutput) => void;
}): JSX.Element {
  return (
    <div className="lf-trace-output-field">
      <label>
        <span>Result</span>
        <select
          className="lf-select"
          aria-label="Trace output"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value === 'raster' ? 'raster' : 'vector')}
        >
          <option value="vector">Editable vectors</option>
          <option value="raster">Raster scan</option>
        </select>
      </label>
      <p className="lf-trace-hint">
        {props.value === 'vector'
          ? 'Editable paths for line or fill operations.'
          : 'Black-and-white traced artwork engraved with image scan motion. Original grayscale shading is not retained.'}
      </p>
    </div>
  );
}

export function TraceFillStylePicker(props: {
  readonly value: TraceFillStyle;
  readonly onChange: (next: TraceFillStyle) => void;
}): JSX.Element {
  const hints = {
    scanline: 'Parallel scanlines fill the traced shapes.',
    offset: 'Follows closed shapes inward, including hollow designs.',
    island: 'Fills connected regions with short straight scanlines.',
  };
  return (
    <div className="lf-trace-output-field">
      <label>
        <span>Fill style</span>
        <select
          className="lf-select"
          aria-label="Trace fill style"
          value={props.value}
          onChange={(e) => props.onChange(parseTraceFillStyle(e.target.value))}
        >
          <option value="scanline">Scanline</option>
          <option value="offset">Follow Shape</option>
          <option value="island">Island Fill</option>
        </select>
      </label>
      <p className="lf-trace-hint">{hints[props.value]}</p>
    </div>
  );
}

function parseTraceFillStyle(value: string): TraceFillStyle {
  return value === 'island' || value === 'offset' ? value : 'scanline';
}

export function CncTraceHint(): JSX.Element {
  return (
    <p className="lf-trace-hint">
      CNC traces stay as editable vectors. Outline presets follow both sides of a stroke; Centerline
      follows its middle.
    </p>
  );
}

export function DeleteImageAfterTraceToggle(props: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label className="lf-trace-delete-source">
      <input
        type="checkbox"
        className="lf-checkbox"
        checked={props.checked}
        title="Remove the source bitmap from the workspace after creating the traced output."
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>Delete Image After trace</span>
    </label>
  );
}

export function DialogActions(props: {
  readonly canSubmit: boolean;
  readonly busy: boolean;
  readonly onCancel: () => void;
}): JSX.Element {
  return (
    <KitDialogActions>
      <Button onClick={props.onCancel}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={!props.canSubmit}>
        {props.busy ? 'Tracing…' : 'Trace'}
      </Button>
    </KitDialogActions>
  );
}
