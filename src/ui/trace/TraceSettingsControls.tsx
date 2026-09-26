import { DEFAULT_LIGHTBURN_TRACE_SETTINGS, type TraceOptions } from '../../core/trace';
import {
  DEFAULT_EDGE_MINIMUM_LINE_PX,
  EDGE_DETAIL_STEP,
  EDGE_SENSITIVITY_STEP,
  edgeDetailFromOptions,
  edgeSensitivityFromOptions,
  mergeLightBurnTraceSettings,
  type LightBurnTraceSettingOverrides,
} from './trace-options';
import { TraceDetectionControls } from './TraceDetectionControls';
import { TraceCheckboxRow } from './TraceCheckboxRow';
import { NumberRow } from './TraceNumberRow';
import { PhotoTraceSettingsControls } from './PhotoTraceSettingsControls';
import { ColourLayerTraceSettingsControls } from './ColourLayerTraceSettingsControls';
import { useStore } from '../state';
import { HYBRID_MAX_STROKE_WIDTH_MM_RANGE, hybridMaxStrokeWidthMm } from './hybrid-stroke-width';

type TraceSettingsControlsProps = {
  readonly preset: TraceOptions;
  readonly overrides: LightBurnTraceSettingOverrides;
  readonly sourceHasTransparency?: boolean | undefined;
  readonly onChange: (next: LightBurnTraceSettingOverrides) => void;
  /** Colours of the current preview trace (Colour layers swatches). */
  readonly previewColours?: ReadonlyArray<string> | undefined;
};

export function TraceSettingsControls(props: TraceSettingsControlsProps): JSX.Element {
  if (props.preset.photoDetail !== undefined) return <PhotoTraceSettingsControls {...props} />;
  if (props.preset.colourLayers !== undefined) {
    return <ColourLayerTraceSettingsControls {...props} />;
  }
  return props.preset.traceMode === 'edge' ? (
    <EdgeTraceSettingsControls {...props} />
  ) : (
    <FilledTraceSettingsControls {...props} />
  );
}

function EdgeTraceSettingsControls(props: TraceSettingsControlsProps): JSX.Element {
  const set = (patch: LightBurnTraceSettingOverrides): void => {
    props.onChange({ ...props.overrides, ...patch });
  };
  const alpha = alphaMaskState(props);
  return (
    <fieldset className="lf-trace-settings">
      <legend>Refine detail</legend>
      <div className="lf-trace-settings-group">
        <NumberRow
          label="Sensitivity"
          min={0}
          max={100}
          step={EDGE_SENSITIVITY_STEP}
          snapToStep
          value={props.overrides.edgeSensitivity ?? edgeSensitivityFromOptions(props.preset)}
          onChange={(edgeSensitivity) => set({ edgeSensitivity })}
        />
        <NumberRow
          label="Detail"
          min={0}
          max={100}
          step={EDGE_DETAIL_STEP}
          snapToStep
          value={props.overrides.edgeDetail ?? edgeDetailFromOptions(props.preset)}
          onChange={(edgeDetail) => set({ edgeDetail })}
        />
        <NumberRow
          label="Minimum line"
          min={0}
          max={1000}
          step={1}
          value={
            props.overrides.edgeMinimumLinePx ??
            props.preset.edgeMinLengthPx ??
            DEFAULT_EDGE_MINIMUM_LINE_PX
          }
          onChange={(edgeMinimumLinePx) => set({ edgeMinimumLinePx })}
        />
        <InvertRow {...props} disabled={alpha.checked} />
      </div>
      <EdgeTraceModeNote />
      <details className="lf-trace-settings-details">
        <summary tabIndex={0} title="Adjust edge smoothing and path simplification.">
          Curve finishing
        </summary>
        <ContourGeometryControls {...props} />
      </details>
      <TransparencyDetails {...props} alpha={alpha} />
      <ResetTraceSettingsButton overrides={props.overrides} onChange={props.onChange} />
    </fieldset>
  );
}

function FilledTraceSettingsControls(props: TraceSettingsControlsProps): JSX.Element {
  const alpha = alphaMaskState(props);
  return (
    <fieldset className="lf-trace-settings">
      <legend>Refine detail</legend>
      <div className="lf-trace-settings-group">
        <TraceDetectionControls {...props} alphaMask={alpha.checked}>
          <BrightnessBandControls {...props} />
        </TraceDetectionControls>
        <InvertRow {...props} disabled={alpha.checked} />
      </div>
      <div className="lf-trace-settings-group">
        <TraceAreaControls {...props} />
      </div>
      <details className="lf-trace-settings-details">
        <summary tabIndex={0} title="Adjust edge smoothing and path simplification.">
          Curve finishing
        </summary>
        <ContourGeometryControls {...props} />
      </details>
      <TransparencyDetails {...props} alpha={alpha} />
      <ResetTraceSettingsButton overrides={props.overrides} onChange={props.onChange} />
    </fieldset>
  );
}

type AlphaMaskState = {
  readonly checking: boolean;
  readonly unavailable: boolean;
  readonly checked: boolean;
};

// Every line preset, Edge Detection included (ADR-437), can trace the alpha
// mask; it only applies once the source is known to carry transparency.
function alphaMaskState(props: TraceSettingsControlsProps): AlphaMaskState {
  const checking = props.sourceHasTransparency === undefined;
  const unavailable = props.sourceHasTransparency === false;
  return {
    checking,
    unavailable,
    checked:
      !checking &&
      !unavailable &&
      traceBooleanValue(props.preset, props.overrides, 'traceTransparency'),
  };
}

function TransparencyDetails(
  props: TraceSettingsControlsProps & { readonly alpha: AlphaMaskState },
): JSX.Element {
  return (
    <details className="lf-trace-settings-details">
      <summary tabIndex={0} title="Trace an image's transparency instead of its brightness.">
        Transparency
      </summary>
      <TraceCheckboxRow
        label="Trace alpha mask"
        checked={props.alpha.checked}
        disabled={props.alpha.checking || props.alpha.unavailable}
        onChange={(traceTransparency) => props.onChange({ ...props.overrides, traceTransparency })}
      />
      {props.alpha.checking ? <AlphaMaskCheckingNote /> : null}
      {props.alpha.unavailable ? <AlphaMaskUnavailableNote /> : null}
    </details>
  );
}

function BrightnessBandControls(props: TraceSettingsControlsProps): JSX.Element {
  const options = mergeLightBurnTraceSettings(props.preset, props.overrides);
  const cutoffLuma = options.cutoffLuma ?? 0;
  const thresholdLuma = options.thresholdLuma ?? 128;
  const set = (patch: LightBurnTraceSettingOverrides): void =>
    props.onChange({
      ...props.overrides,
      detectionMode: 'manual',
      cutoffLuma,
      thresholdLuma,
      ...patch,
    });
  return (
    <>
      <NumberRow
        label="Cutoff"
        min={0}
        max={255}
        step={1}
        value={cutoffLuma}
        onChange={(next) => set({ cutoffLuma: next })}
      />
      <NumberRow
        label="Threshold"
        min={0}
        max={255}
        step={1}
        value={thresholdLuma}
        onChange={(next) => set({ thresholdLuma: next })}
      />
    </>
  );
}

// Invert picks which tones are the artwork, so it sits with detection. The
// alpha mask ignores brightness, so Invert stands down while it is on.
function InvertRow(
  props: TraceSettingsControlsProps & { readonly disabled?: boolean },
): JSX.Element {
  return (
    <TraceCheckboxRow
      label="Invert"
      checked={props.overrides.invert ?? props.preset.invert ?? false}
      disabled={props.disabled === true}
      onChange={(invert) => props.onChange({ ...props.overrides, invert })}
    />
  );
}

function TraceAreaControls(props: TraceSettingsControlsProps): JSX.Element {
  const set = (patch: LightBurnTraceSettingOverrides): void =>
    props.onChange({ ...props.overrides, ...patch });
  return (
    <>
      <NumberRow
        label="Remove ink specks"
        min={0}
        max={10000}
        step={1}
        value={props.overrides.despeckleMinPixels ?? props.preset.despeckleMinPixels ?? 0}
        onChange={(despeckleMinPixels) => set({ despeckleMinPixels })}
      />
      {props.preset.traceMode !== 'centerline' ? (
        <NumberRow
          label="Ignore Less Than"
          min={0}
          max={10000}
          step={1}
          value={props.overrides.ignoreLessThanPixels ?? props.preset.ignoreLessThanPixels ?? 0}
          onChange={(ignoreLessThanPixels) => set({ ignoreLessThanPixels })}
        />
      ) : null}
      {props.preset.traceMode === 'hybrid' ? <HybridStrokeWidthRow {...props} /> : null}
      <TraceCheckboxRow
        label="Fill tiny holes"
        checked={props.overrides.fillPinholeCracks ?? props.preset.fillPinholeCracks ?? false}
        onChange={(fillPinholeCracks) => set({ fillPinholeCracks })}
      />
    </>
  );
}

// Line + fill (ADR-454): ink up to this wide on the placed artwork burns
// once down its centre; wider ink stays a filled outline.
function HybridStrokeWidthRow(props: TraceSettingsControlsProps): JSX.Element {
  const device = useStore((s) => s.project.device);
  const machineKind = useStore((s) => s.project.machine?.kind);
  return (
    <NumberRow
      label="Max stroke width"
      min={HYBRID_MAX_STROKE_WIDTH_MM_RANGE.min}
      max={HYBRID_MAX_STROKE_WIDTH_MM_RANGE.max}
      step={0.05}
      value={hybridMaxStrokeWidthMm(props.overrides, device, machineKind)}
      onChange={(hybridMaxStrokeWidthMm) =>
        props.onChange({ ...props.overrides, hybridMaxStrokeWidthMm })
      }
    />
  );
}

// Centerline gives the two knobs their corner / tolerance roles (ADR-405).
const CENTERLINE_SMOOTHNESS_TITLE =
  'Higher values round more bends into curves; 0 keeps every bend as a corner.';
const CENTERLINE_OPTIMIZE_TITLE =
  'Higher values let curves stray further from the stroke centre for fewer nodes.';

function ContourGeometryControls(props: TraceSettingsControlsProps): JSX.Element {
  // Line + fill's strokes are Centerline strokes: the knobs steer them the
  // same way (and its fill outlines as usual).
  const centerline = props.preset.traceMode === 'centerline' || props.preset.traceMode === 'hybrid';
  const set = (patch: LightBurnTraceSettingOverrides): void => {
    props.onChange({ ...props.overrides, ...patch });
  };
  return (
    <>
      <NumberRow
        label="Smoothness"
        min={0}
        max={1.33}
        step={0.01}
        value={traceValue(props.preset, props.overrides, 'smoothness')}
        onChange={(smoothness) => set({ smoothness })}
        {...(centerline ? { title: CENTERLINE_SMOOTHNESS_TITLE } : {})}
      />
      <NumberRow
        label="Optimize"
        min={0}
        max={2}
        step={0.01}
        value={traceValue(props.preset, props.overrides, 'optimize')}
        onChange={(optimize) => set({ optimize })}
        {...(centerline ? { title: CENTERLINE_OPTIMIZE_TITLE } : {})}
      />
    </>
  );
}

type NumericTraceSettingKey = Extract<
  keyof LightBurnTraceSettingOverrides,
  'smoothness' | 'optimize'
>;
type BooleanTraceSettingKey = Extract<keyof LightBurnTraceSettingOverrides, 'traceTransparency'>;

function traceValue(
  preset: TraceOptions,
  overrides: LightBurnTraceSettingOverrides,
  key: NumericTraceSettingKey,
): number {
  const override = overrides[key];
  if (override !== undefined) return override;
  const presetValue = preset[key];
  return presetValue ?? DEFAULT_LIGHTBURN_TRACE_SETTINGS[key];
}

function traceBooleanValue(
  preset: TraceOptions,
  overrides: LightBurnTraceSettingOverrides,
  key: BooleanTraceSettingKey,
): boolean {
  const override = overrides[key];
  if (override !== undefined) return override;
  return preset[key] ?? DEFAULT_LIGHTBURN_TRACE_SETTINGS[key];
}

function ResetTraceSettingsButton(props: {
  readonly overrides: LightBurnTraceSettingOverrides;
  readonly onChange: (next: LightBurnTraceSettingOverrides) => void;
}): JSX.Element {
  return (
    <div className="lf-trace-reset-row">
      <button
        type="button"
        onClick={() => props.onChange({})}
        disabled={Object.keys(props.overrides).length === 0}
        className="lf-btn"
        title="Reset all trace controls to the selected tracing preset."
      >
        Reset trace settings
      </button>
    </div>
  );
}

function EdgeTraceModeNote(): JSX.Element {
  return (
    <p style={edgeTraceNoteStyle}>
      Closed outlines around dark artwork and locally darker detail. Adjacent dark tones may merge
      into one outline. Use Centerline for a single path down the middle of a stroke.
    </p>
  );
}

function AlphaMaskUnavailableNote(): JSX.Element {
  return (
    <p style={alphaMaskNoteStyle}>
      No transparent pixels detected; alpha mask will not change this image.
    </p>
  );
}

function AlphaMaskCheckingNote(): JSX.Element {
  return <p style={alphaMaskNoteStyle}>Checking image transparency...</p>;
}

const edgeTraceNoteStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  margin: 0,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
const alphaMaskNoteStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  margin: '-2px 0 0 22px',
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
