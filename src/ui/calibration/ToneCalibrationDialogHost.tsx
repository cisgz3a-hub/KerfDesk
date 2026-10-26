// Not in the job barrel: its export count is ratcheted (ADR-015).
import {
  generateToneCalibrationWedge,
  type ToneWedgeOptions,
} from '../../core/job/tone-calibration-wedge';
import { confirmDiscardAsync } from '../app/confirm-discard';
import { usePlatform } from '../app/platform-context';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { writeLastToneWedge, type ToneWedgeRecordTarget } from './tone-calibration-draft';
import { useToneCalibrationLibrary, type ToneCalibrationRecord } from './tone-calibration-library';
import { closeToneCalibration, useToneCalibrationStore } from './tone-calibration-store';
import { ToneCalibrationDialog } from './ToneCalibrationDialog';

export function ToneCalibrationDialogHost(): JSX.Element | null {
  const session = useToneCalibrationStore((state) => state.session);
  const platform = usePlatform();
  if (session === null) return null;
  const generate = async (
    options: ToneWedgeOptions,
    target: ToneWedgeRecordTarget,
  ): Promise<void> => {
    if (!(await confirmDiscardAsync(platform, 'create a tone calibration wedge'))) return;
    const wedge = generateToneCalibrationWedge(options);
    useStore.getState().replaceSceneWithGeneratedScene(wedge.scene);
    writeLastToneWedge(target);
    closeToneCalibration();
    useToastStore
      .getState()
      .pushToast(
        `Generated a tone wedge of ${wedge.patches.length} patches. Burn it, then open ` +
          'Tools → Tone Calibration → Record the result.',
        'success',
      );
  };
  const save = (record: ToneCalibrationRecord): void => {
    const stored = useToneCalibrationLibrary.getState().save(record);
    closeToneCalibration();
    useToastStore
      .getState()
      .pushToast(
        stored
          ? `Saved tone calibration "${record.curve.label}". Choose it in Photo engraving.`
          : `Tone calibration "${record.curve.label}" is available until KerfDesk closes; ` +
              'this computer did not let it be saved.',
        stored ? 'success' : 'warning',
      );
  };
  return (
    <ToneCalibrationDialog
      key={session.sessionId}
      initialStep={session.step}
      seed={session.seed}
      onClose={closeToneCalibration}
      onGenerate={(options, target) => void generate(options, target)}
      onSave={save}
    />
  );
}
