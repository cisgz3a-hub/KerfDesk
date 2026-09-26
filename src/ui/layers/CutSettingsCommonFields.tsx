import {
  DEFAULT_PERFORATION_CUT_MM,
  DEFAULT_PERFORATION_SKIP_MM,
} from '../../core/job/operation-cut-extras';
import type { Layer, LayerMode } from '../../core/scene';
import { MAX_OVERCUT_MM, MAX_PERFORATION_MM, MIN_PERFORATION_MM } from './cut-settings-draft';
import { useStore } from '../state';
import { CutPowerModeField } from './CutPowerModeField';
import { LaserProcessField } from './LaserProcessField';

export function CutSettingsCommonFields(props: {
  readonly layer: Layer;
  readonly mode: LayerMode;
  readonly maxFeed?: number;
  readonly operationMembershipEditable?: boolean;
  readonly onModeChange: (mode: LayerMode) => void;
  readonly onPowerChange?: (power: number) => void;
}): JSX.Element {
  const controllerKind = useStore((state) => state.project.device.controllerKind);
  const speedValue =
    props.maxFeed === undefined ? props.layer.speed : Math.min(props.layer.speed, props.maxFeed);
  const speedMax = props.maxFeed === undefined ? {} : { max: props.maxFeed };
  return (
    <>
      <LaserProcessField
        name="mode"
        mode={props.mode}
        ariaLabel="Cut settings mode"
        onChange={props.onModeChange}
        autoFocus
      />
      <fieldset className="lf-fieldset lf-cut-settings-group">
        <legend className="lf-legend">Essential settings</legend>
        <Field label="Power">
          <PowerInput value={props.layer.power} onChange={props.onPowerChange} />
          <span className="lf-field-unit">%</span>
        </Field>
        <Field label="Speed">
          <NumberInput name="speed" value={speedValue} min={1} label="speed" {...speedMax} />
          <span className="lf-field-unit">mm/min</span>
        </Field>
        <Field label="Passes">
          <NumberInput name="passes" value={props.layer.passes} min={1} step={1} label="passes" />
        </Field>
      </fieldset>
      {props.mode !== 'image' ? (
        <details className="lf-cut-settings-disclosure">
          <summary title="Show how the controller applies laser power during motion">
            Power behaviour
          </summary>
          <div className="lf-cut-settings-disclosure__body">
            <CutPowerModeField controllerKind={controllerKind} layer={props.layer} />
          </div>
        </details>
      ) : null}
      {props.operationMembershipEditable !== false ? (
        <MembershipFields layer={props.layer} />
      ) : null}
      {props.mode === 'line' ? <LineModeFields layer={props.layer} /> : null}
    </>
  );
}

function MembershipFields(props: { readonly layer: Layer }): JSX.Element {
  return (
    <details className="lf-cut-settings-disclosure">
      <summary title="Show controls for workspace visibility and job output">
        Visibility &amp; output
      </summary>
      <div className="lf-cut-settings-disclosure__body">
        <Field label="Show on workspace">
          <input
            name="visible"
            type="checkbox"
            className="lf-checkbox"
            defaultChecked={props.layer.visible}
            title="Show or hide this layer on the workspace without changing output."
          />
        </Field>
        <Field label="Include in output">
          <input
            name="output"
            type="checkbox"
            className="lf-checkbox"
            defaultChecked={props.layer.output}
            title="Include or exclude this layer when previewing, framing, exporting, or starting jobs."
          />
        </Field>
      </div>
    </details>
  );
}

function PowerInput(props: {
  readonly value: number;
  readonly onChange: ((power: number) => void) | undefined;
}): JSX.Element {
  return (
    <NumberInput
      name="power"
      value={props.value}
      min={0}
      max={100}
      label="power"
      onChange={(event) => {
        if (Number.isFinite(event.target.valueAsNumber))
          props.onChange?.(event.target.valueAsNumber);
      }}
    />
  );
}

function LineModeFields(props: { readonly layer: Layer }): JSX.Element {
  return (
    <fieldset className="lf-fieldset lf-cut-settings-group">
      <legend className="lf-legend">Line detail</legend>
      <p className="lf-laser-help">Refine the cut path and leave bridges to hold parts in place.</p>
      <Field label="Contour entry">
        <NumberInput
          name="fillOverscanMm"
          value={props.layer.fillOverscanMm}
          min={0}
          max={25}
          step={0.5}
          label="contour entry"
          title="Shared with Fill overscan. On 4040-safe, Line contours use up to 5 mm of laser-off feed-matched entry; other profiles may not apply it."
        />
        <span className="lf-field-unit">mm</span>
      </Field>
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
      <Field label="Overcut">
        <NumberInput
          name="overcutMm"
          value={props.layer.overcutMm ?? 0}
          min={0}
          max={MAX_OVERCUT_MM}
          step={0.01}
          label="overcut"
          title="Keep cutting past the start of each closed shape on the final pass so the seam is cut through. 0 turns it off. Shapes opened by tabs or perforation are not overcut."
        />
        <span className="lf-field-unit">mm</span>
      </Field>
      <LineBridgeFields layer={props.layer} />
      <LinePerforationFields layer={props.layer} />
    </fieldset>
  );
}

function LinePerforationFields(props: { readonly layer: Layer }): JSX.Element {
  return (
    <fieldset
      className="lf-fieldset"
      title="Cut the line as dashes with uncut gaps, for tear-off parts and fold lines."
    >
      <legend>Perforation</legend>
      <p className="lf-laser-help">
        Cuts dashes with uncut gaps between them. Closed shapes always keep a full gap before their
        start point.
      </p>
      <Field label="Enable">
        <input
          name="perforationEnabled"
          type="checkbox"
          className="lf-checkbox"
          defaultChecked={props.layer.perforationEnabled === true}
          aria-label="Cut settings enable perforation"
          title="Cut every line on this layer as dashes separated by uncut gaps."
        />
      </Field>
      <Field label="Cut">
        <NumberInput
          name="perforationCutMm"
          value={props.layer.perforationCutMm ?? DEFAULT_PERFORATION_CUT_MM}
          min={MIN_PERFORATION_MM}
          max={MAX_PERFORATION_MM}
          step={0.01}
          label="perforation cut length"
          title="Length of each cut dash in millimeters."
        />
        <span className="lf-field-unit">mm</span>
      </Field>
      <Field label="Skip">
        <NumberInput
          name="perforationSkipMm"
          value={props.layer.perforationSkipMm ?? DEFAULT_PERFORATION_SKIP_MM}
          min={MIN_PERFORATION_MM}
          max={MAX_PERFORATION_MM}
          step={0.01}
          label="perforation skip length"
          title="Length of each uncut gap between dashes in millimeters."
        />
        <span className="lf-field-unit">mm</span>
      </Field>
    </fieldset>
  );
}

function LineBridgeFields(props: { readonly layer: Layer }): JSX.Element {
  return (
    <fieldset
      className="lf-fieldset"
      title="Leave small uncut bridges on closed Line cuts so parts stay attached until you remove them."
    >
      <legend>Tabs / Bridges</legend>
      <p className="lf-laser-help">Small uncut gaps keep parts attached to the sheet.</p>
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
  readonly onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
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
      onChange={props.onChange}
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

const controlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const numberStyle: React.CSSProperties = { width: 96 };
