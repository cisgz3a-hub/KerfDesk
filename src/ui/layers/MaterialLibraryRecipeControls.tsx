import { Button } from '../kit';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import type { MaterialLibraryPresetOption } from './material-library-preset-options';
import {
  buttonRowStyle,
  calibrationContextStyle,
  calibrationHeadingStyle,
  calibrationTextStyle,
} from './material-library-panel-styles';

export function MaterialLibraryRecipeControls(props: {
  readonly activeLayerId: string;
  readonly targetName?: string | undefined;
  readonly activePresetId: string;
  readonly activePresetOption: MaterialLibraryPresetOption | null;
  readonly onAssign: () => boolean;
  readonly onLink: () => boolean;
  readonly onDelete: () => boolean;
  readonly onStatus: (message: string) => void;
}): JSX.Element {
  const applyDisabled = props.activeLayerId === '' || props.activePresetId === '';
  const deleteDisabled = props.activePresetOption === null;
  return (
    <>
      <div style={buttonRowStyle}>
        <Button
          variant="primary"
          aria-label="Apply selected material preset to layer"
          title="Apply the selected material preset to the selected layer."
          disabled={applyDisabled}
          onClick={() => {
            props.onStatus(props.onAssign() ? 'Applied to layer.' : 'Preset was not applied.');
          }}
        >
          Apply to {props.targetName?.trim() || 'operation'}
        </Button>
      </div>
      <PresetMatchSummary option={props.activePresetOption} />
      <details className="material-library-panel__disclosure" hidden={deleteDisabled}>
        <summary title="Expand controls for linking or deleting the selected preset.">
          Link or delete this preset
        </summary>
        <div className="material-library-panel__details">
          <p style={calibrationTextStyle}>
            Link to track changes to this preset and refresh the operation when you choose.
          </p>
          <div style={buttonRowStyle}>
            <Button
              aria-label="Link selected material preset to layer"
              title="Link this layer to the preset while keeping a last-known settings snapshot."
              disabled={applyDisabled}
              onClick={() =>
                props.onStatus(
                  props.onLink() ? 'Linked preset to layer.' : 'Preset was not linked.',
                )
              }
            >
              Link to operation
            </Button>
            <Button
              aria-label="Delete selected material preset"
              title="Delete the selected preset from this material library."
              variant="danger"
              disabled={deleteDisabled}
              onClick={() => {
                if (props.activePresetOption === null) return;
                const label = presetDeleteLabel(props.activePresetOption);
                if (!jobAwareConfirm(`Delete preset "${label}"?`)) {
                  props.onStatus('Delete cancelled.');
                  return;
                }
                props.onStatus(props.onDelete() ? 'Preset deleted.' : 'Preset was not deleted.');
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </details>
    </>
  );
}

function presetDeleteLabel(option: MaterialLibraryPresetOption): string {
  const preset = option.preset;
  const label =
    preset.thicknessMm !== undefined ? `${formatThickness(preset.thicknessMm)} mm` : preset.title;
  return `${preset.materialName} - ${label ?? 'Preset'}`;
}

function formatThickness(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function PresetMatchSummary(props: {
  readonly option: MaterialLibraryPresetOption | null;
}): JSX.Element | null {
  if (props.option === null) return null;
  return (
    <div aria-label="Selected material recipe match" style={calibrationContextStyle}>
      <strong style={calibrationHeadingStyle}>Preset Match</strong>
      <span style={calibrationTextStyle}>{props.option.statusText}</span>
      {props.option.warnings.map((warning) => (
        <span key={warning} style={calibrationTextStyle}>
          {warning}
        </span>
      ))}
    </div>
  );
}
