import type { RotarySetup } from '../../core/devices';
import { rotaryPresetsFor } from '../../core/devices/rotary-presets';
import { generateRotaryCalibrationPattern } from '../../core/job';
import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useToastStore } from '../state/toast-store';
import { RotarySetupDialog } from './RotarySetupDialog';
import { rotaryArtworkExtent } from './rotary-wrap-preview';

export function RotarySetupHost(props: { readonly onClose: () => void }): JSX.Element {
  const setup = useStore((s) => s.project.device.rotary);
  const machineFamily = useStore((s) => s.project.device.machineFamily);
  const scene = useStore((s) => s.project.scene);
  const controller = useStore((s) => s.project.device.controllerKind ?? 'grbl-v1.1');
  const dialect = useStore((s) => s.project.device.gcodeDialect?.dialectId);
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
    const heightMm = pattern.heightMm.toFixed(2);
    pushToast(
      `Generated ${pattern.widthMm.toFixed(0)} x ${heightMm} mm rotary test pattern. ` +
        `Burned, it should measure ${heightMm} mm around the part.`,
      'success',
    );
  };
  return (
    <RotarySetupDialog
      setup={setup}
      onCancel={props.onClose}
      onApply={apply}
      onGenerateCalibration={generate}
      presets={rotaryPresetsFor(machineFamily === undefined ? {} : { machineFamily })}
      artwork={rotaryArtworkExtent(scene)}
      outputDescription={`${controller}${dialect === undefined ? '' : ` / ${dialect}`}`}
    />
  );
}
