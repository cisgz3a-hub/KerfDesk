import { Button } from '../kit';

export type CutSettingsDefaultHandlers = {
  readonly onMakeDefault: () => void;
  readonly onMakeDefaultForAll: () => void;
  readonly onResetToDefault: () => void;
  // The color Make Default saves under. It is usually the artwork's own color
  // rather than the operation's palette color, so the button names it.
  readonly makeDefaultColor: string;
};

export function CutSettingsDefaultActions(props: CutSettingsDefaultHandlers): JSX.Element {
  return (
    <details className="lf-cut-settings-disclosure">
      <summary title="Show options for saving or restoring default operation settings">
        Saved defaults
      </summary>
      <div className="lf-cut-settings-disclosure__body">
        <p className="lf-laser-help">
          Apply edits before saving a default. Reset restores the saved settings immediately.
        </p>
        <section aria-label="Default layer settings" className="lf-cut-settings-default-actions">
          <Button
            type="button"
            onClick={props.onMakeDefault}
            title={`Remember this layer's settings as the default for new artwork colored ${props.makeDefaultColor}.`}
          >
            Make Default for {props.makeDefaultColor}
          </Button>
          <Button
            type="button"
            onClick={props.onResetToDefault}
            title="Reset this layer to the saved default settings."
          >
            Reset to Default
          </Button>
          <Button
            type="button"
            onClick={props.onMakeDefaultForAll}
            title="Use this layer's settings as the default for all layer colors."
          >
            Make Default for All
          </Button>
        </section>
      </div>
    </details>
  );
}
