import type { RotarySetup } from '../../core/devices';
import { generateRotaryCalibrationPattern } from '../../core/job';
import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useToastStore } from '../state/toast-store';
import { RotarySetupDialog } from './RotarySetupDialog';

export function RotarySetupHost(props: { readonly onClose: () => void }): JSX.Element {
  const setup = useStore((s) => s.project.device.rotary);
  const dirty = useStore((s) => s.dirty);
  const updateDeviceProfile = useStore((s) => s.updateDeviceProfile);
  const replaceScene = useStore((s) => s.replaceSceneWithGeneratedScene);
  const pushToast = useToastStore((s) => s.pushToast);
  const apply = (rotary: RotarySetup): void => {
    updateDeviceProfile({ rotary });
    props.onClose();
    pushToast(rotary.enabled ? 'Rotary enabled for this profile.' : 'Rotary disabled.', 'success');
  };
  const generate = (rotary: RotarySetup): void => {
    if (
      dirty &&
      !jobAwareConfirm('Generating the rotary test pattern replaces the current artwork. Continue?')
    ) {
      return;
    }
    updateDeviceProfile({ rotary });
    const pattern = generateRotaryCalibrationPattern(rotary);
    replaceScene(pattern.scene);
    props.onClose();
    pushToast(
      `Generated ${pattern.widthMm.toFixed(0)} x ${pattern.heightMm.toFixed(2)} mm rotary test pattern.`,
      'success',
    );
  };
  return (
    <RotarySetupDialog
      setup={setup}
      onCancel={props.onClose}
      onApply={apply}
      onGenerateCalibration={generate}
    />
  );
}
