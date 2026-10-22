// The labelled row and uncontrolled number box every Cut Settings group uses,
// shared by CutSettingsCommonFields and LineTabFields.

export function NumberInput(props: {
  readonly name: string;
  readonly value: number;
  readonly min: number;
  readonly max?: number;
  /** Only whole-number settings (passes, tab counts) set a step: any other
   * value the project can store must pass the browser's check on Apply. */
  readonly step?: 1;
  readonly label?: string;
  readonly title?: string;
  readonly onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
}): JSX.Element {
  const bounds = boundsAdmitting(props.value, props.min, props.max);
  return (
    <input
      name={props.name}
      type="number"
      className="lf-input"
      min={bounds.min}
      {...(bounds.max !== undefined ? { max: bounds.max } : {})}
      step={props.step ?? 'any'}
      defaultValue={props.value}
      onChange={props.onChange}
      style={numberStyle}
      aria-label={`Cut settings ${props.label ?? props.name}`}
      title={props.title ?? `Set cut settings ${props.label ?? props.name}.`}
    />
  );
}

/**
 * A field's range widened to take the value it opens with. Values the app
 * itself stores (an inch speed, a LightBurn layer, an inspector entry, a
 * library recipe) can sit outside the dialog's range for new entries, and the
 * browser would otherwise refuse Apply over a field the operator never touched
 * (audit 2026-10-21 06-P2-4, as `imageDensityBounds` does for image density).
 * A new entry is still held to the range.
 */
export function boundsAdmitting(
  shown: number,
  min: number,
  max?: number,
): { readonly min: number; readonly max?: number } {
  if (!Number.isFinite(shown)) return max === undefined ? { min } : { min, max };
  return {
    min: Math.min(min, shown),
    ...(max === undefined ? {} : { max: Math.max(max, shown) }),
  };
}

export function Field(props: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="lf-field">
      <span className="lf-field-label lf-field-label--md">{props.label}</span>
      <span style={controlStyle}>{props.children}</span>
    </label>
  );
}

export const controlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const numberStyle: React.CSSProperties = { width: 96 };
