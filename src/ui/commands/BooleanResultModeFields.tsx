export function BooleanResultModeFields(props: {
  readonly keep: boolean;
  readonly retain: boolean;
  readonly setKeep: (value: boolean) => void;
  readonly setRetain: (value: boolean) => void;
}): JSX.Element {
  return (
    <fieldset>
      <legend>Result</legend>
      <label className="lf-field">
        <input
          type="checkbox"
          checked={props.keep}
          title="Keep separate source objects in the job as well as the result."
          onChange={(event) => props.setKeep(event.currentTarget.checked)}
        />
        Keep source objects
      </label>
      <label className="lf-field">
        <input
          type="checkbox"
          checked={props.retain}
          title="Retain editable source outlines inside one live compound. Only the result is output."
          onChange={(event) => props.setRetain(event.currentTarget.checked)}
        />
        Create live compound
      </label>
      {props.retain ? (
        <p>
          Source outlines remain editable through Edit compound sources. Text and shapes are
          retained as outlines. Only the compound result belongs to the job.
        </p>
      ) : null}
    </fieldset>
  );
}
