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
          Apply edits before saving a default. Make Default uses it for added operations in this
          canvas. New and restart use app starter values; Reset explicitly reuses saved settings.
          Choose power and speed from a material recipe or your selected machine’s instructions.
        </p>
        <section aria-label="Default layer settings" className="lf-cut-settings-default-actions">
          <Button
            type="button"
            onClick={props.onMakeDefault}
            title={`Save settings for ${props.makeDefaultColor} and use them for added artwork in this canvas. New and restart do not apply them automatically.`}
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
            title="Save settings for all colours and use them for added artwork in this canvas. New and restart use app starter values."
          >
            Make Default for All
          </Button>
        </section>
      </div>
    </details>
  );
}
