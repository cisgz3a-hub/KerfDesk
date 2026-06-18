import type { MaterialLibraryCalibrationContext as CalibrationContext } from '../state/material-library-calibration';
import { Button } from '../kit';
import { MaterialLibraryCalibrationContext } from './MaterialLibraryCalibrationContext';
import { CreatePresetForm } from './MaterialLibraryCreatePresetForm';

export function MaterialLibraryRecipeControls(props: {
  readonly activeLayerId: string;
  readonly activePresetId: string;
  readonly entryCount: number;
  readonly calibrationContext: CalibrationContext | null;
  readonly onAssign: () => boolean;
  readonly onPresetCreated: (id: string) => void;
  readonly onStatus: (message: string) => void;
}): JSX.Element {
  const assignDisabled = props.activeLayerId === '' || props.activePresetId === '';
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
      <MaterialLibraryCalibrationContext context={props.calibrationContext} />
      <CreatePresetForm
        targetLayerId={createLayerId}
        entryCount={props.entryCount}
        isCalibrated={props.calibrationContext !== null}
        onCreated={(id) => {
          props.onPresetCreated(id);
          props.onStatus(
            props.calibrationContext === null
              ? 'Preset created.'
              : 'Calibrated recipe created.',
          );
        }}
        onFailed={props.onStatus}
      />
    </>
  );
}
