// Machine Setup's question for a CNC that KerfDesk 1.0.29 may have made from a
// laser (rolling audit v10 V2-P2-2, ADR-637 Amendment 8). It shows on every
// step while the machine Setup opened on is that CNC and the draft is still
// CNC only. "It's a laser" puts the draft on Laser, which Save applies, and
// the laser-mode question (Amendment 7) follows when `$32=0`. "This is a CNC
// router" is kept, so nothing asks again.

import type { ConvertedLaserSuspicion } from '../../../core/preflight/converted-laser-profile';
import { Button } from '../../kit';
import {
  CONVERTED_LASER_HEADING,
  CONVERTED_LASER_RISK,
  convertedLaserHintSentence,
  convertedLaserQuestion,
  useConvertedLaserAnswerStore,
  type ConvertedLaserControllerState,
} from '../../state/converted-laser-question';
import { useLaserStore } from '../../state/laser-store';
import type { DeviceSetupState, DeviceSetupStepProps } from './device-setup-flow';

export function DeviceSetupConvertedLaser({
  state,
  dispatch,
}: DeviceSetupStepProps): JSX.Element | null {
  const detectedSettings = useLaserStore((s) => s.detectedSettings);
  const controllerBuildInfo = useLaserStore((s) => s.controllerBuildInfo);
  const routerAnswered = useConvertedLaserAnswerStore((s) => s.routerAnswered);
  const question = setupConvertedLaserQuestion(
    state,
    { detectedSettings, controllerBuildInfo },
    routerAnswered,
  );
  if (question === null) return null;
  const hints = convertedLaserHintSentence(question);
  return (
    <div className="lf-setup-laser-mode-off" role="status" aria-live="polite">
      <strong>{CONVERTED_LASER_HEADING}</strong>
      <p className="lf-setup-muted">
        {CONVERTED_LASER_RISK}
        {hints === null ? null : ` ${hints}`}
      </p>
      <Button
        variant="primary"
        onClick={() => dispatch({ kind: 'set-machine-kinds', machineKinds: ['laser'] })}
      >
        It&apos;s a laser
      </Button>
      <Button onClick={() => useConvertedLaserAnswerStore.getState().answerRouter()}>
        This is a CNC router
      </Button>
    </div>
  );
}

/** The question while this draft still holds the CNC Setup opened on, or
 *  null. Save keeps a CNC as the operator's answer only when it is null. */
export function setupConvertedLaserQuestion(
  state: Pick<DeviceSetupState, 'baseline' | 'baselineMachine' | 'machineKinds'>,
  controller: ConvertedLaserControllerState,
  routerAnswered?: boolean,
): ConvertedLaserSuspicion | null {
  if (state.machineKinds.length !== 1 || state.machineKinds[0] !== 'cnc') return null;
  return convertedLaserQuestion(
    { device: state.baseline, machine: state.baselineMachine },
    controller,
    routerAnswered,
  );
}
