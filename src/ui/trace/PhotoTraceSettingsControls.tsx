import { useId } from 'react';
import type { TraceOptions } from '../../core/trace';
import type { LightBurnTraceSettingOverrides } from './trace-options';

type PhotoTraceSettingsControlsProps = {
  readonly preset: TraceOptions;
  readonly overrides: LightBurnTraceSettingOverrides;
  readonly onChange: (next: LightBurnTraceSettingOverrides) => void;
};

export function PhotoTraceSettingsControls(props: PhotoTraceSettingsControlsProps): JSX.Element {
  const set = (patch: LightBurnTraceSettingOverrides): void => {
    props.onChange({ ...props.overrides, ...patch });
  };
  return (
    <fieldset className="lf-trace-settings">
      <legend>Refine photo</legend>
      <div className="lf-trace-settings-group">
        <PhotoNumberRow
          label="Detail"
          min={0}
          value={props.overrides.photoDetail ?? props.preset.photoDetail ?? 60}
          hint="Higher values preserve finer shading and create more paths."
          onChange={(photoDetail) => set({ photoDetail })}
        />
        <PhotoNumberRow
          label="Brightness"
          min={-100}
          value={props.overrides.photoBrightness ?? props.preset.brightness ?? 0}
          hint="Raise this to lighten the photo; lower it to deepen the shadows."
          onChange={(photoBrightness) => set({ photoBrightness })}
        />
        <PhotoNumberRow
          label="Contrast"
          min={-100}
          value={props.overrides.photoContrast ?? props.preset.contrast ?? 0}
          hint="Raise this to separate light and dark tones; lower it for softer shading."
          onChange={(photoContrast) => set({ photoContrast })}
        />
        <PhotoNumberRow
          label="Midtones"
          min={0.1}
          max={5}
          step={0.1}
          value={props.overrides.photoGamma ?? props.preset.gamma ?? 1}
          hint="1 keeps the original midtones. Raise to lighten them or lower to darken them; black and white stay fixed."
          onChange={(photoGamma) => set({ photoGamma })}
        />
      </div>
      <p className="lf-trace-hint">
        Light and shadow are made from fine filled lines. More detail creates more paths.
      </p>
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
    </fieldset>
  );
}

function PhotoNumberRow(props: {
  readonly label: string;
  readonly min: number;
  readonly max?: number;
  readonly step?: number;
  readonly value: number;
  readonly hint: string;
  readonly onChange: (next: number) => void;
}): JSX.Element {
  const inputId = useId();
  const hintId = useId();
  const change = (value: string): void => {
    const numeric = Number(value);
    props.onChange(
      Number.isFinite(numeric)
        ? Math.max(props.min, Math.min(props.max ?? 100, numeric))
        : props.min,
    );
  };
  return (
    <div className="lf-trace-number">
      <label htmlFor={inputId}>
        <span>{props.label}</span>
        <span className="lf-trace-number-input">
          <input
            id={inputId}
            className="lf-input"
            type="number"
            min={props.min}
            max={props.max ?? 100}
            step={props.step ?? 1}
            value={props.value}
            onChange={(event) => change(event.target.value)}
            aria-label={`Trace ${props.label}`}
            aria-describedby={hintId}
            title={props.hint}
          />
        </span>
      </label>
      <input
        type="range"
        min={props.min}
        max={props.max ?? 100}
        step={props.step ?? 1}
        value={props.value}
        onChange={(event) => change(event.target.value)}
        aria-label={`Trace ${props.label} slider`}
        aria-describedby={hintId}
        title={props.hint}
      />
      <p id={hintId}>{props.hint}</p>
    </div>
  );
}
