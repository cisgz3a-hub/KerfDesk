import { Button } from '../kit';
import type { CanvasBitmapSize } from '../workspace/use-canvas-bitmap-size';
import { TextFormattingFields } from './TextFormattingFields';
import { CanvasTextSymbols } from './CanvasTextSymbols';
import type { DialogFields } from './use-text-dialog-fields';
import type { useCanvasTextActions } from './use-canvas-text-actions';
import { canvasTextPanelPosition } from './canvas-text-panel-position';
import { CanvasVariableTextFields } from './CanvasVariableTextFields';
import type { CanvasTextVariables } from './use-canvas-text-variables';

export function CanvasTextPanel(props: {
  readonly variables: CanvasTextVariables;
  readonly fields: DialogFields;
  readonly insert: (text: string) => void;
  readonly actions: ReturnType<typeof useCanvasTextActions>;
  readonly pending: boolean;
  readonly error: string | null;
  readonly companion: boolean;
  readonly inputStyle: React.CSSProperties;
  readonly canvasSize: CanvasBitmapSize;
}): JSX.Element {
  const { fields, actions } = props;
  return (
    <section
      className="lf-canvas-text-panel"
      aria-label="Text formatting"
      style={canvasTextPanelPosition(props.inputStyle, props.canvasSize)}
    >
      <div className="lf-canvas-text-heading">
        <strong>Text</strong>
        <span>Editing on canvas</span>
      </div>
      <div className="lf-canvas-text-scroll">
        <fieldset className="lf-canvas-text-fields" disabled={actions.saving}>
          <TextFormattingFields
            fields={fields}
            onInsert={props.insert}
            variableFields={
              <CanvasVariableTextFields
                fields={fields}
                variables={props.variables}
                onInsert={props.insert}
              />
            }
          />
          <CanvasTextSymbols onInsert={props.insert} />
        </fieldset>
      </div>
      <p id="canvas-text-help" className="lf-canvas-text-help">
        Enter for a new line · Ctrl/⌘ + Enter to finish · Esc to cancel
      </p>
      {props.companion && (
        <p className="lf-canvas-text-help">Type in the box beside the live lettering.</p>
      )}
      {props.error !== null && (
        <p role="alert" className="lf-canvas-text-error">
          {props.error}
        </p>
      )}
      <div className="lf-canvas-text-actions">
        <span role="status">
          {actions.saving ? 'Saving…' : props.pending ? 'Updating…' : 'Live preview'}
        </span>
        <Button onClick={actions.cancel}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => void actions.save()}
          disabled={actions.saving || !fields.fontAvailable || !fields.pathAvailable}
        >
          Done
        </Button>
      </div>
    </section>
  );
}
