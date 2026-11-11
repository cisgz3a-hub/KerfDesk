import type { Layer } from '../../core/scene';

/** ADR-699: the longest ramp the form takes, in mm. */
export const MAX_FILL_RAMP_LENGTH_MM = 25;

/**
 * LightBurn-style Fill Ramp (ADR-699): power rises from Min power at the
 * shape's edges to full Power over the ramp length, sloping the walls of the
 * burn. Rubber stamps use it so fine letters stand on a supporting shoulder.
 * The hidden marker tells the form reader the fields were shown.
 */
export function CutSettingsFillRampFields(props: { readonly layer: Layer }): JSX.Element {
  const length = props.layer.fillRampLengthMm ?? 0;
  return (
    <fieldset className="lf-fieldset lf-cut-settings-group">
      <legend className="lf-legend">Ramp</legend>
      <input
        type="hidden"
        name="fillRampShown"
        value="1"
        title="Hidden marker that the Ramp fields were shown, used when saving cut settings."
      />
      <p className="lf-laser-help">
        Slopes the sides of the fill for rubber stamps: power rises from Min power at each edge to
        full Power over the ramp length. 0 turns the ramp off. A ramped fill burns as a scan of
        varying power, like an image.
      </p>
      <Field label="Ramp length">
        <input
          name="fillRampLengthMm"
          type="number"
          className="lf-input"
          min={0}
          max={Math.max(MAX_FILL_RAMP_LENGTH_MM, length)}
          step="any"
          defaultValue={length}
          style={numberStyle}
          aria-label="Cut settings ramp length"
          title="How far in from each edge power takes to reach full Power. 0 turns the ramp off."
        />
        <span className="lf-field-unit">mm</span>
      </Field>
      <Field label="Ramp min power">
        <input
          name="fillRampMinPower"
          type="number"
          className="lf-input"
          min={0}
          max={100}
          step="any"
          defaultValue={props.layer.minPower}
          style={numberStyle}
          aria-label="Cut settings ramp min power"
          title="Power at the very edge of the fill. Set it just above the power at which your laser starts to mark."
        />
        <span className="lf-field-unit">%</span>
      </Field>
      <Field label="Ramp outer edge">
        <input
          name="fillRampOuterEdge"
          type="checkbox"
          className="lf-checkbox"
          defaultChecked={props.layer.fillRampOuterEdge === true}
          aria-label="Cut settings ramp outer edge"
          title="Also slope the edges that face the outside of the artwork. Leave it off for a stamp, so its border is cut square."
        />
      </Field>
    </fieldset>
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
