import type { ReactNode } from 'react';
import type { TraceOptions } from '../../core/trace';
import type { TraceReport } from '../../core/trace/trace-steps';
import {
  automaticBandThreshold,
  overridesForDetectionMode,
  traceDetectionMode,
  type LightBurnTraceSettingOverrides,
  type TraceDetectionMode,
} from './trace-options';

export function TraceDetectionControls(props: {
  readonly preset: TraceOptions;
  readonly overrides: LightBurnTraceSettingOverrides;
  readonly alphaMask: boolean;
  /** What the matching finished preview chose; undefined until one exists. */
  readonly report?: TraceReport | undefined;
  readonly onChange: (next: LightBurnTraceSettingOverrides) => void;
  readonly children: ReactNode;
}): JSX.Element {
  if (props.alphaMask) {
    return (
      <>
        <p style={noteStyle}>Tracing transparency. Cutoff and Threshold apply to the alpha mask.</p>
        {props.children}
      </>
    );
  }
  const mode = traceDetectionMode(props.preset, props.overrides);
  const automaticPreset =
    props.preset.autoSketchTrace === true || props.preset.useOtsuThreshold === true;
  const manual = mode === 'manual' || (mode === 'preset' && !automaticPreset);
  return (
    <>
      <label className="lf-trace-detection">
        <span>Detection</span>
        <select
          aria-label="Trace detection"
          className="lf-select"
          value={mode}
          onChange={(event) =>
            props.onChange(
              overridesForDetectionMode(
                props.preset,
                props.overrides,
                parseDetectionMode(event.target.value),
                props.report,
              ),
            )
          }
          title="Choose automatic detection, faint-line recovery, a manual brightness band, or sketch tracing."
        >
          <option value="preset">{presetDetectionLabel(props.preset)}</option>
          <option value="faint-lines">Faint lines (keep solid areas)</option>
          <option value="manual">Manual brightness band</option>
          <option value="sketch">Sketch (local contrast)</option>
        </select>
      </label>
      {manual ? (
        props.children
      ) : (
        <AutomaticDetectionNotes mode={mode} preset={props.preset} report={props.report} />
      )}
    </>
  );
}

// Automatic detection still keeps a brightness band as its solid ink (except
// Sketch), so show that band read-only and say which route the trace took.
function AutomaticDetectionNotes(props: {
  readonly mode: TraceDetectionMode;
  readonly preset: TraceOptions;
  readonly report: TraceReport | undefined;
}): JSX.Element {
  const band = props.mode === 'sketch' ? null : automaticBandNote(props.preset, props.report);
  return (
    <>
      {band === null ? null : <p style={noteStyle}>{band}</p>}
      <p style={noteStyle}>{detectionNote(props.mode, props.preset, props.report)}</p>
    </>
  );
}

function automaticBandNote(preset: TraceOptions, report: TraceReport | undefined): string | null {
  if (preset.autoSketchTrace === true) {
    const [cutoff, threshold] = presetBand(preset);
    return `Band in use: Cutoff ${cutoff}, Threshold ${threshold}.`;
  }
  if (preset.useOtsuThreshold !== true) return null;
  if (report?.lightingLevelled === true) {
    return 'Band in use: none. Uneven lighting was evened out before the cut, so no single brightness band matches it.';
  }
  const automatic = report?.automaticThresholdLuma;
  return automatic === undefined
    ? 'Band in use: set from this image when the preview finishes.'
    : `Band in use: Cutoff 0, Threshold ${automaticBandThreshold(automatic)}, set from this image.`;
}

function presetDetectionLabel(preset: TraceOptions): string {
  if (preset.autoSketchTrace === true) return 'Automatic (band + pale colour detail)';
  return preset.useOtsuThreshold === true ? 'Automatic threshold (Otsu)' : 'Preset brightness band';
}

const MANUAL_BAND_TIP = 'Choose Manual brightness band to set Cutoff and Threshold.';

function detectionNote(
  mode: TraceDetectionMode,
  preset: TraceOptions,
  report: TraceReport | undefined,
): string {
  if (mode === 'faint-lines')
    return 'Adds continuous pale strokes while keeping solid ink. Small isolated pale specks are ignored.';
  if (mode === 'sketch')
    return 'Local contrast detects the artwork; a brightness band is not used.';
  if (preset.autoSketchTrace === true)
    return `${lineArtRouteNote(preset, report)} ${MANUAL_BAND_TIP}`;
  return report?.automaticThresholdLuma === undefined
    ? MANUAL_BAND_TIP
    : 'Choose Manual brightness band to set Cutoff and Threshold; it starts from the band in use.';
}

// Line Art adds local-contrast marks only when the image has enough colour
// (auto-sketch-trace.ts); the report says which way this image went.
function lineArtRouteNote(preset: TraceOptions, report: TraceReport | undefined): string {
  if (report?.localDetailAdded === true)
    return 'Colour detail found: pale marks darker than their surroundings are added to the band.';
  if (report?.localDetailAdded === false) {
    const [cutoff, threshold] = presetBand(preset);
    return `No colour detail found: using brightness band ${cutoff}–${threshold} only.`;
  }
  return 'In colour artwork, pale marks darker than their surroundings are added to the band.';
}

function presetBand(preset: TraceOptions): readonly [number, number] {
  return [preset.cutoffLuma ?? 0, preset.thresholdLuma ?? 128];
}

function parseDetectionMode(value: string): TraceDetectionMode {
  return value === 'manual' || value === 'sketch' || value === 'faint-lines' ? value : 'preset';
}

const noteStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  margin: 0,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
