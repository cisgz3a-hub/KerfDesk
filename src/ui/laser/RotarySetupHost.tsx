import type { RotarySetup } from '../../core/devices';
import { rotaryPresetsFor } from '../../core/devices/rotary-presets';
import { rotaryAxesForController } from '../../core/devices/rotary-axis';
import { generateRotaryCalibrationPattern } from '../../core/job';
import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useToastStore } from '../state/toast-store';
import { RotarySetupDialog } from './RotarySetupDialog';
import { rotaryArtworkExtent } from './rotary-wrap-preview';
import { newRotarySetupFor } from './rotary-setup-edit';

// ADR-127 Amd 5 (code quality audit C2 D2-P3-5): the .rd file carries
// KerfDesk's own Y scale and surface speeds. Not yet checked on a Ruida
// machine, so the note says so.
export const RUIDA_ROTARY_NOTE =
  "On a Ruida, KerfDesk writes the rotary into the .rd file itself: it scales Y and sets each stroke's " +
  "speed for the part's surface. Leave the controller's own rotary function off, or Y may be scaled " +
  'twice. This has not been checked on a Ruida machine yet, so run a test pattern first.';

// A K40 (Lihuiyu) and a Moshiboard turn a Y-port rotary through their own
// programs: KerfDesk splits each stroke's speed into whole mm/s for the
// surface (ADR-703 Amendment 1, ADR-705 Amendment 1). Neither board can run a
// rotary on A or Z.
export const USB_LINK_ROTARY_NOTE =
  "On a K40 or Moshiboard, KerfDesk scales Y and sets each stroke's speed for the part's surface in whole " +
  'mm/s; a speed change stops the head briefly. Use the Y port. This has not been checked on a machine yet, so ' +
  'run a test pattern first.';

const CONTROLLER_ROTARY_NOTES: Partial<Record<string, string>> = {
  ruida: RUIDA_ROTARY_NOTE,
  lihuiyu: USB_LINK_ROTARY_NOTE,
  moshi: USB_LINK_ROTARY_NOTE,
};

export function RotarySetupHost(props: { readonly onClose: () => void }): JSX.Element {
  const setup = useStore((s) => s.project.device.rotary);
  const machineFamily = useStore((s) => s.project.device.machineFamily);
  const scene = useStore((s) => s.project.scene);
  const controller = useStore((s) => s.project.device.controllerKind ?? 'grbl-v1.1');
  const commandSet = useStore((s) => s.project.device.controllerCommandSet);
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
      setup={
        setup ??
        newRotarySetupFor({
          ...(machineFamily === undefined ? {} : { machineFamily }),
          ...(commandSet === undefined ? {} : { controllerCommandSet: commandSet }),
        })
      }
      onCancel={props.onClose}
      onApply={apply}
      onGenerateCalibration={generate}
      presets={rotaryPresetsFor({
        ...(machineFamily === undefined ? {} : { machineFamily }),
        ...(commandSet === undefined ? {} : { controllerCommandSet: commandSet }),
      })}
      axes={rotaryAxesForController({ controllerKind: controller })}
      artwork={rotaryArtworkExtent(scene)}
      outputDescription={`${controller}${dialect === undefined ? '' : ` / ${dialect}`}`}
      {...(CONTROLLER_ROTARY_NOTES[controller] === undefined
        ? {}
        : { controllerNote: CONTROLLER_ROTARY_NOTES[controller] })}
    />
  );
}
