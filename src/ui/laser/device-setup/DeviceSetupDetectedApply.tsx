import type { DeviceProfile } from '../../../core/devices';
import { helpProps } from '../../help/help-topics';
import { Button } from '../../kit';
import { SpindleScaleChoice } from '../../machine/SpindleScaleChoice';
import { cncDetectedSpindleScale } from '../../machine/cnc-detected-apply';
import { useSpindleScaleChoice } from '../../machine/use-spindle-scale-choice';
import type { DeviceSetupStepProps } from './device-setup-flow';

export function DeviceSetupDetectedApply(
  props: DeviceSetupStepProps & {
    readonly detected: Partial<DeviceProfile>;
  },
): JSX.Element {
  const scale =
    props.state.machineKind === 'cnc' ? cncDetectedSpindleScale(props.detected) : undefined;
  const offerRpm = scale !== undefined;
  const rpmChoice = useSpindleScaleChoice(scale);
  return (
    <div>
      {offerRpm && scale !== undefined ? (
        <SpindleScaleChoice
          value={scale}
          checked={rpmChoice.checked}
          onChange={rpmChoice.onChange}
        />
      ) : null}
      <Button
        variant="primary"
        onClick={() =>
          props.dispatch({
            kind: 'accept-detected',
            patch: props.detected,
            useSpindleScaleAsRpm: offerRpm && rpmChoice.checked,
          })
        }
        {...helpProps('control:laser.device-setup.apply-detected')}
      >
        Use detected values
      </Button>
    </div>
  );
}
