import type { ComponentProps, ReactNode } from 'react';
import type { RasterImage } from '../../core/scene';
import { Dialog } from '../kit';
import {
  DialogActions,
  DeleteImageAfterTraceToggle,
  PresetPicker,
  TraceDialogHeader,
  TraceOutputFields,
} from './dialog-parts';
import { TraceSettingsControls } from './TraceSettingsControls';
import { PhotoOutputGuidance } from './PhotoOutputGuidance';
import { traceSettingEdits } from './trace-setting-edits';
import { TraceWorkflowGuide } from './TraceWorkflowGuide';
import './tracer-dialog.css';

// Slots keep this layout independent of worker state and commit ownership.
export function TraceDialogView(props: {
  readonly source: RasterImage;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
  readonly presetName: string;
  readonly onPresetChange: (name: string) => void;
  readonly settings: ComponentProps<typeof TraceSettingsControls>;
  readonly output: ComponentProps<typeof TraceOutputFields>;
  readonly preview: ReactNode;
  readonly deleteSource: boolean;
  readonly onDeleteSourceChange: (value: boolean) => void;
  readonly canSubmit: boolean;
  readonly busy: boolean;
}): JSX.Element {
  return (
    <Dialog
      onClose={props.onClose}
      ariaLabel="Trace image"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
      size="xl"
      panelClassName="lf-trace-dialog"
    >
      <TraceDialogHeader source={props.source} onClose={props.onClose} />
      <div className="lf-trace-dialog-body">
        <section className="lf-trace-dialog-artwork" aria-label="Preview and compare">
          {props.preview}
        </section>
        <aside className="lf-trace-dialog-controls" aria-label="Trace controls">
          <TraceWorkflowGuide
            source={props.source}
            settings={props.settings}
            output={props.output.traceOutput}
            photoShading={props.output.photoShading === true}
          />
          <fieldset disabled={props.busy} className="lf-trace-commit-fields">
            <PresetPicker
              machineKind={props.output.machineKind}
              value={props.presetName}
              onChange={props.onPresetChange}
              edits={traceSettingEdits(
                props.settings.preset,
                props.settings.overrides,
                props.settings.sourceHasTransparency,
              )}
            />
            <TraceSettingsControls {...props.settings} />
            <section className="lf-trace-output" aria-label="Trace output options">
              <h3>Output</h3>
              <TraceOutputFields {...props.output} />
              {props.output.photoShading ? (
                <PhotoOutputGuidance source={props.source} machineKind={props.output.machineKind} />
              ) : null}
            </section>
          </fieldset>
        </aside>
      </div>
      <footer className="lf-trace-dialog-footer">
        <fieldset disabled={props.busy} className="lf-trace-commit-fields">
          <DeleteImageAfterTraceToggle
            checked={props.deleteSource}
            onChange={props.onDeleteSourceChange}
          />
        </fieldset>
        <DialogActions canSubmit={props.canSubmit} busy={props.busy} onCancel={props.onClose} />
      </footer>
    </Dialog>
  );
}
