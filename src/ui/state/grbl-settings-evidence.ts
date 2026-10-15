import type { ControllerDriver } from '../../core/controllers';
import {
  beginReportUnitsWrite,
  unqualifiedControllerSettingsPatch,
} from './controller-report-units';
import { qualifyingController } from './laser-controller-qualification';
import { frameProofReset } from './laser-session-reset';
import type { LaserState } from './laser-store';

/** A setting can reach the firmware even when its transport result or ACK is
 * lost. Retire the old read before dispatch, and let only the subsequent $$
 * response establish what the controller actually stored. The Console's
 * canonical classification also identifies settings that change coordinates
 * or physical travel; process-only settings preserve the Frame (ADR-565). */
export function grblSettingWriteEvidencePatch(
  state: LaserState,
  driver: Pick<ControllerDriver, 'prepareConsoleCommand' | 'commands'>,
  id: number,
  value: string,
): Partial<LaserState> {
  const prepared = driver.prepareConsoleCommand(`$${id}=${value}`);
  const changesPosition = prepared.ok && prepared.command.stateEffect === 'configuration';
  return {
    ...unqualifiedControllerSettingsPatch(state),
    // A vendor contract may allow process-only Console writes without a dump
    // command (Falcon air settings). Keep its no-dump qualification unchanged.
    ...(driver.commands.settingsQuery !== null || id === 13
      ? {
          controllerQualification: qualifyingController(
            state.controllerSessionEpoch,
            'settings-read',
          ),
        }
      : {}),
    ...(id === 13 ? { ...beginReportUnitsWrite(), ...frameProofReset() } : {}),
    ...(changesPosition
      ? {
          ...frameProofReset(),
          statusReport: null,
          statusObservation: null,
          homingProof: null,
          homingState: 'unknown',
          wcoCache: null,
          workOriginActive: false,
          workOriginSource: 'none',
          workZZeroEvidence: null,
          trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
          workZReferenceEpoch: state.workZReferenceEpoch + 1,
        }
      : {}),
  };
}
