import type { ReactNode } from 'react';
import type { TraceOptions } from '../../core/trace';
import {
  traceDetectionMode,
  type LightBurnTraceSettingOverrides,
  type TraceDetectionMode,
} from './trace-options';

export function TraceDetectionControls(props: {
  readonly preset: TraceOptions;
  readonly overrides: LightBurnTraceSettingOverrides;
  readonly alphaMask: boolean;
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
      <label style={rowStyle}>
        <span>Detection</span>
        <select
          aria-label="Trace detection"
          className="lf-select"
          value={mode}
          onChange={(event) =>
            props.onChange({
              ...props.overrides,
              detectionMode: parseDetectionMode(event.target.value),
            })
          }
          title="Choose automatic detection, a manual brightness band, or local-contrast sketch tracing."
        >
          <option value="preset">{presetDetectionLabel(props.preset)}</option>
          <option value="manual">Manual brightness band</option>
          <option value="sketch">Sketch (local contrast)</option>
        </select>
      </label>
      {manual ? props.children : <p style={noteStyle}>{detectionNote(mode, props.preset)}</p>}
    </>
  );
}

function presetDetectionLabel(preset: TraceOptions): string {
  if (preset.autoSketchTrace === true) return 'Automatic (preserve pale details)';
  return preset.useOtsuThreshold === true ? 'Automatic threshold (Otsu)' : 'Preset brightness band';
}

function detectionNote(mode: TraceDetectionMode, preset: TraceOptions): string {
  if (mode === 'sketch')
    return 'Local contrast detects the artwork; a brightness band is not used.';
  if (preset.autoSketchTrace === true) {
    return 'Line Art automatically preserves pale logo details. Choose Manual brightness band to set Cutoff and Threshold.';
  }
  return 'The image determines the threshold automatically. Choose Manual brightness band to set Cutoff and Threshold.';
}

function parseDetectionMode(value: string): TraceDetectionMode {
  return value === 'manual' || value === 'sketch' ? value : 'preset';
}

const rowStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  display: 'grid',
  gridTemplateColumns: '82px 1fr',
  gap: 6,
  alignItems: 'center',
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
const noteStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  margin: 0,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
