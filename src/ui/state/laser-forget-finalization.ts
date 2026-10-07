import { selectControllerDriver } from '../../core/controllers';
import { disconnectedControllerQualification } from './laser-controller-qualification';
import { recoveryRepository } from './recovery';
import { retainedDisconnectSafetyNotice } from './laser-disconnect-safety';
import { initialLaserState } from './laser-store-helpers';
import { useToastStore } from './toast-store';
import type { LaserSafetyNotice } from './laser-safety-notice';
import type { LaserState, LiveRefs } from './laser-store';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type LiveConnection = NonNullable<LiveRefs['connection']>;

export function finalizeForgottenControllerOnce(
  connection: LiveConnection,
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  retainedSafetyNotice: LaserSafetyNotice | null,
): Promise<void> {
  const existing = refs.forgetFinalizations.get(connection);
  if (existing !== undefined) return existing;
  const finalization = finalizeForgottenController(set, get, refs, retainedSafetyNotice);
  refs.forgetFinalizations.set(connection, finalization);
  return finalization;
}

export async function finalizeForgottenController(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  retainedSafetyNotice: LaserSafetyNotice | null,
): Promise<void> {
  const safetyNotice = retainedSafetyNotice ?? retainedDisconnectSafetyNotice(get());
  // purgeControllerData clears its published recovery snapshot and writes the
  // deletion generation before its first await. Start it, then reset the live
  // controller state immediately so a slow IndexedDB delete cannot leave a
  // closed port looking connected and qualified.
  const purge = recoveryRepository.purgeControllerData();
  refs.driver = selectControllerDriver(undefined);
  set((state) => ({
    ...initialLaserState(),
    incidentHistory: state.incidentHistory ?? [],
    controllerSessionEpoch: state.controllerSessionEpoch + 1,
    controllerQualification: disconnectedControllerQualification(state.controllerSessionEpoch + 1),
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
    workZReferenceEpoch: state.workZReferenceEpoch + 1,
    safetyNotice,
  }));

  let purgeWarning: string | null = null;
  try {
    const purged = await purge;
    if (!purged.ok) purgeWarning = `recovery storage reported ${purged.error}`;
  } catch (error) {
    purgeWarning = error instanceof Error ? error.message : String(error);
  }
  if (purgeWarning !== null) {
    useToastStore
      .getState()
      .pushToast(
        `Controller state was reset, but recovery storage could not be purged: ${purgeWarning}`,
        'warning',
      );
  }
}
