import type { MaterialLibraryCalibrationContext as CalibrationContext } from '../state/material-library-calibration';
import { Button } from '../kit';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { MaterialLibraryCalibrationContext } from './MaterialLibraryCalibrationContext';
import { CreatePresetForm } from './MaterialLibraryCreatePresetForm';
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
  readonly entryCount: number;
  readonly activePresetOption: MaterialLibraryPresetOption | null;
  readonly calibrationContext: CalibrationContext | null;
  readonly onAssign: () => boolean;
  readonly onUpdate: () => boolean;
  readonly onDelete: () => boolean;
  readonly onPresetCreated: (id: string) => void;
  readonly onStatus: (message: string) => void;
}): JSX.Element {
  const assignDisabled =
    props.activeLayerId === '' ||
    props.activePresetId === '' ||
    props.activePresetOption?.isAssignable === false;
  const updateDisabled = props.activeLayerId === '' || props.activePresetId === '';
  const deleteDisabled = props.activePresetOption === null;
  const createLayerId = props.calibrationContext?.layer.id ?? props.activeLayerId;
  return (
    <>
      <div style={buttonRowStyle}>
        <Button
          aria-label="Assign selected material preset"
          title="Apply the selected material preset to the selected layer."
          disabled={assignDisabled}
          onClick={() => {
            props.onStatus(
              props.onAssign() ? `Assigned to ${props.activeLayerId}.` : 'Preset was not assigned.',
            );
          }}
        >
          Assign
        </Button>
        <Button
          aria-label="Update selected material preset from layer"
          title="Replace the selected preset recipe with the selected layer's current settings."
          disabled={updateDisabled}
          onClick={() => {
            props.onStatus(props.onUpdate() ? 'Preset updated.' : 'Preset was not updated.');
          }}
        >
          Update
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
      <MaterialLibraryCalibrationContext context={props.calibrationContext} />
      <CreatePresetForm
        targetLayerId={createLayerId}
        entryCount={props.entryCount}
        isCalibrated={props.calibrationContext !== null}
        onCreated={(id) => {
          props.onPresetCreated(id);
          props.onStatus(
            props.calibrationContext === null ? 'Preset created.' : 'Calibrated recipe created.',
          );
        }}
        onFailed={props.onStatus}
      />
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
