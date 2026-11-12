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
  "speed for the part's surface. A Ruida layer holds one speed, so a curved stroke is burned in " +
  'pieces, a few speeds at a time, with short moves between them, and takes longer than on a flat ' +
  "bed. Leave the controller's own rotary function off, or Y may be scaled twice. This has not been " +
  'checked on a Ruida machine yet, so run a test pattern first.';

// A K40 (Lihuiyu) and a Moshiboard turn a Y-port rotary through their own
// programs, with each stroke's speed set for the surface. Neither board can run
// a rotary on A or Z. A Moshiboard runs whole mm/s (ADR-705 Amendment 1); a
// K40 runs speed classes 5 % apart, no slower than its slowest speed (ADR-703
// Amendment 2). The export names any dose that leaves 95-105 %.
export const MOSHI_ROTARY_NOTE =
  "On a Moshiboard, KerfDesk scales Y and sets each stroke's speed for the part's surface in whole mm/s, so " +
  'slow strokes can burn lighter or darker; the export says how much. Use the Y port. This has not been checked ' +
  'on a machine yet, so run a test pattern first.';

export const K40_ROTARY_NOTE =
  "On a K40, KerfDesk scales Y and sets each stroke's speed for the part's surface, in steps 5 % apart; a " +
  'speed change stops the head briefly, and nothing runs slower than 23.5 mm/min. Use the Y port. This has ' +
  'not been checked on a machine yet, so run a test pattern first.';

const CONTROLLER_ROTARY_NOTES: Partial<Record<string, string>> = {
  ruida: RUIDA_ROTARY_NOTE,
  lihuiyu: K40_ROTARY_NOTE,
  moshi: MOSHI_ROTARY_NOTE,
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
