import type { Layer, LayerMode } from '../../core/scene';

export function CutSettingsCommonFields(props: {
  readonly layer: Layer;
  readonly mode: LayerMode;
  readonly maxFeed?: number;
  readonly onModeChange: (mode: LayerMode) => void;
}): JSX.Element {
  const speedValue =
    props.maxFeed === undefined ? props.layer.speed : Math.min(props.layer.speed, props.maxFeed);
  const speedMax = props.maxFeed === undefined ? {} : { max: props.maxFeed };
  return (
    <>
      <Field label="Mode">
        <select
          name="mode"
          className="lf-select"
          value={props.mode}
          onChange={(event) => props.onModeChange(parseMode(event.target.value))}
          aria-label="Cut settings mode"
          title="Choose whether this layer cuts outlines, fills closed shapes, or raster engraves images."
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
        <NumberInput name="speed" value={speedValue} min={1} label="speed" {...speedMax} />
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
          title="Show or hide this layer on the workspace without changing output."
        />
      </Field>
      <Field label="Output">
        <input
          name="output"
          type="checkbox"
          className="lf-checkbox"
          defaultChecked={props.layer.output}
          title="Include or exclude this layer when previewing, framing, exporting, or starting jobs."
        />
      </Field>
      <Field label="Air">
        <input
          name="airAssist"
          type="checkbox"
          className="lf-checkbox"
          defaultChecked={props.layer.airAssist}
          title="Turn on air assist for this layer when the device profile is configured for M7 or M8."
        />
      </Field>
      {props.mode === 'line' ? <LineModeFields layer={props.layer} /> : null}
    </>
  );
}

function LineModeFields(props: { readonly layer: Layer }): JSX.Element {
  return (
    <>
      <Field label="Kerf Offset">
        <NumberInput
          name="kerfOffsetMm"
          value={props.layer.kerfOffsetMm}
          min={-10}
          max={10}
          step={0.01}
          label="kerf offset"
          title="Compensate laser beam width on closed Line cuts. Positive cuts outside outer contours and inside holes; source artwork is unchanged."
        />
        <span className="lf-field-unit">mm</span>
      </Field>
      <fieldset
        className="lf-fieldset"
        title="Leave small uncut bridges on closed Line cuts so parts stay attached until you remove them."
      >
        <legend>Tabs / Bridges</legend>
        <Field label="Enable">
          <input
            name="tabsEnabled"
            type="checkbox"
            className="lf-checkbox"
            defaultChecked={props.layer.tabsEnabled}
            aria-label="Cut settings enable tabs"
            title="Enable automatic bridge gaps on closed Line cuts."
          />
        </Field>
        <Field label="Size">
          <NumberInput
            name="tabSizeMm"
            value={props.layer.tabSizeMm}
            min={0.01}
            max={100}
            step={0.01}
            label="tab size"
            title="Set the length of each uncut bridge gap in millimeters."
          />
          <span className="lf-field-unit">mm</span>
        </Field>
        <Field label="Count">
          <NumberInput
            name="tabsPerShape"
            value={props.layer.tabsPerShape}
            min={1}
            max={100}
            step={1}
            label="tabs per shape"
            title="Set how many evenly spaced bridge gaps to add to each closed outer contour."
          />
        </Field>
        <Field label="Holes">
          <input
            name="tabSkipInnerShapes"
            type="checkbox"
            className="lf-checkbox"
            defaultChecked={props.layer.tabSkipInnerShapes}
            aria-label="Cut settings skip inner tabs"
            title="Leave inner contours and holes whole instead of adding tabs to them."
          />
          <span className="lf-field-help">Skip inner shapes</span>
        </Field>
      </fieldset>
    </>
  );
}

function NumberInput(props: {
  readonly name: string;
  readonly value: number;
  readonly min: number;
  readonly max?: number;
  readonly step?: number;
  readonly label?: string;
  readonly title?: string;
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
      title={props.title ?? `Set cut settings ${props.label ?? props.name}.`}
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

function parseMode(value: string): LayerMode {
  if (value === 'fill' || value === 'image') return value;
  return 'line';
}

const controlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const numberStyle: React.CSSProperties = { width: 96 };
