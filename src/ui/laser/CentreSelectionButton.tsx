import { rotaryAppliesTo } from '../../core/job/rotary-job';
import { machineKindOf } from '../../core/scene';
import { positioningLightIssue } from '../../core/devices/positioning-light';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { selectedObjectIds } from '../state/scene-group-actions';
import { headMoveBlockMessage } from './head-move-dispatch';
import { centreSelectionLight } from './centre-selection-light';
import { openMachineSetup } from './device-setup/machine-setup-dialog-store';
import { controllerActionFailureHandler } from './report-controller-action-failure';

export function CentreSelectionButton({
  disabled,
}: {
  readonly disabled: boolean;
}): JSX.Element | null {
  const laserMode = useStore((state) => machineKindOf(state.project.machine) === 'laser');
  const needsSetup = useStore((state) => {
    const light = state.project.device.positioningLight;
    return (
      light === undefined ||
      positioningLightIssue(
        light,
        state.project.device.controllerKind,
        state.project.device.gcodeDialect?.dialectId,
      ) !== null
    );
  });
  const fileOnly = useStore((state) => state.project.device.controllerKind === 'ruida');
  const lightEnabled = useLaserStore((state) => state.positioningLightEnabled);
  const machineBlocked = useLaserStore((state) => headMoveBlockMessage(state));
  const blocked = useCentreBlockMessage(fileOnly, needsSetup, disabled, machineBlocked);
  if (!laserMode && !lightEnabled) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {laserMode ? (
        <button
          type="button"
          className="lf-btn"
          aria-label="Centre & LED"
          title={
            blocked ??
            'Move with the cutting beam off, then switch on the separate positioning light at the selection centre.'
          }
          disabled={blocked !== null}
          onClick={() => {
            void centreSelectionLight().catch(controllerActionFailureHandler('Centre & LED'));
          }}
        >
          Centre &amp; LED
        </button>
      ) : null}
      {laserMode && needsSetup && !fileOnly ? (
        <button
          type="button"
          className="lf-btn"
          title="Open Machine Setup to configure the separate positioning light and its offset."
          onClick={() =>
            openMachineSetup({ kind: 'step', step: 'options', highlight: 'positioning-light' })
          }
        >
          Set up LED
        </button>
      ) : null}
      <PositioningLightOffButton configured={laserMode && !needsSetup && !fileOnly} />
    </div>
  );
}

function PositioningLightOffButton({
  configured,
}: {
  readonly configured: boolean;
}): JSX.Element | null {
  const lightEnabled = useLaserStore((state) => state.positioningLightEnabled);
  const off = useLaserStore((state) => state.switchPositioningLightOff);
  const blocked = useLaserStore((state) => headMoveBlockMessage(state));
  if (!lightEnabled && !configured) return null;
  return (
    <button
      type="button"
      className="lf-btn"
      aria-label="LED off"
      title={
        blocked ??
        'Switch off the separate positioning light. Its physical state is not reported by the controller.'
      }
      disabled={blocked !== null}
      onClick={() => {
        void off().catch(controllerActionFailureHandler('LED off'));
      }}
    >
      LED off
    </button>
  );
}

function useCentreBlockMessage(
  fileOnly: boolean,
  needsSetup: boolean,
  disabled: boolean,
  machineBlocked: string | null,
): string | null {
  const hasSelection = useStore((state) => {
    const selected = new Set(selectedObjectIds(state));
    return state.project.scene.objects.some((object) => selected.has(object.id));
  });
  const absolute = useStore((state) => state.jobPlacement.startFrom === 'absolute');
  const rotary = useStore((state) => rotaryAppliesTo(state.project.device, state.project.machine));
  if (fileOnly)
    return 'Ruida is file export only. Position the head and switch its light at the machine.';
  if (needsSetup)
    return 'Configure the separate LED/crosshair commands and offset in Machine Setup.';
  if (!hasSelection) return 'Select a trace or other artwork to centre the head on.';
  if (!absolute)
    return 'Centre selection needs Absolute Coords. Use Frame to locate artwork placed from an origin.';
  if (rotary) return 'Centre & LED needs a flat bed; a rotary canvas Y is not a bed position.';
  return machineBlocked ?? (disabled ? 'Wait for the current machine operation to finish.' : null);
}
