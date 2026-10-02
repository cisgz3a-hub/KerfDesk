import { useStore } from '../state/store';
import { useLaserStore } from '../state/laser-store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { jobStartMarkBlockMessage } from '../state/laser-job-start-mark-actions';
import { runJobStartMarkNow, useJobStartMarkPreparation } from './use-job-start-mark';

export function JobStartMarkControl(props: { readonly disabled: boolean }): JSX.Element | null {
  const machineKind = useStore((state) => state.project.machine?.kind ?? 'laser');
  const device = useStore((state) => state.project.device);
  const laser = useLaserStore();
  const enabled = useExperimentalLaserFeatures((state) => state.features.lowPowerFire);
  const preparing = useJobStartMarkPreparation((state) => state.pending);
  const framePending = useFramePreparationStore((state) => state.pending);
  if (machineKind !== 'laser') return null;
  // These subscriptions also refresh the refusal copy after explicit opt-in.
  const reason = !enabled
    ? 'Enable Low-power Fire in Tools > Labs.'
    : device.fireControl?.enabled !== true
      ? 'Enable low-power Fire in Machine Setup > Options.'
      : jobStartMarkBlockMessage(laser);
  const active = laser.controllerOperation?.kind === 'job-start-mark';
  return (
    <button
      type="button"
      className="lf-btn"
      onClick={() => {
        void runJobStartMarkNow();
      }}
      disabled={props.disabled || preparing || framePending || reason !== null}
      title={
        reason ??
        'Move with the laser off to the first emitted burn point, mark at capped low power for about one second, then return. Abort remains available in the Live Motion bar.'
      }
    >
      {active ? 'Marking job start…' : preparing ? 'Preparing start mark…' : 'Mark job start · 1 s'}
    </button>
  );
}
