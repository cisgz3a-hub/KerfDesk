/** A controller S ceiling is not evidence of the spindle's actual RPM. */
export function SpindleScaleChoice(props: {
  readonly value: number;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label>
      <input
        type="checkbox"
        aria-label="Use S maximum as spindle RPM"
        title="Copy the configured S maximum as spindle RPM only when your spindle configuration maps S values directly to RPM."
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />{' '}
      Use configured S maximum {props.value} as spindle RPM. Select only when your spindle
      configuration maps S values directly to RPM; this is not a speed measurement.
    </label>
  );
}
