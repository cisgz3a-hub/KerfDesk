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
  readonly activePresetId: string;
  readonly activePresetOption: MaterialLibraryPresetOption | null;
  readonly onAssign: () => boolean;
  readonly onDelete: () => boolean;
  readonly onStatus: (message: string) => void;
}): JSX.Element {
  const applyDisabled =
    props.activeLayerId === '' ||
    props.activePresetId === '' ||
    props.activePresetOption?.isAssignable === false;
  const deleteDisabled = props.activePresetOption === null;
  return (
    <>
      <div style={buttonRowStyle}>
        <Button
          aria-label="Apply selected material preset to layer"
          title="Apply the selected material preset to the selected layer."
          disabled={applyDisabled}
          onClick={() => {
            // ADR-045: apply-on-warning (e.g. a device mismatch) is allowed but
            // confirmed, so the operator sees why before it lands. A clean match
            // (no warnings) applies directly; 'unsupported' is disabled above.
            const warnings = props.activePresetOption?.warnings ?? [];
            if (warnings.length > 0 && !jobAwareConfirm(`${warnings.join(' ')} Apply it anyway?`)) {
              props.onStatus('Preset not applied.');
              return;
            }
            props.onStatus(props.onAssign() ? 'Applied to layer.' : 'Preset was not applied.');
          }}
        >
          Apply to layer
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
      <PresetMatchSummary option={props.activePresetOption} />
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
