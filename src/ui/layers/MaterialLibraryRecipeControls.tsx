import type { MaterialLibraryCalibrationContext as CalibrationContext } from '../state/material-library-calibration';
import { Button } from '../kit';
import { MaterialLibraryCalibrationContext } from './MaterialLibraryCalibrationContext';
import { CreatePresetForm } from './MaterialLibraryCreatePresetForm';
import type { MaterialLibraryPresetOption } from './material-library-preset-options';
import {
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
  readonly onPresetCreated: (id: string) => void;
  readonly onStatus: (message: string) => void;
}): JSX.Element {
  const assignDisabled =
    props.activeLayerId === '' ||
    props.activePresetId === '' ||
    props.activePresetOption?.isAssignable === false;
  const createLayerId = props.calibrationContext?.layer.id ?? props.activeLayerId;
  return (
    <>
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
