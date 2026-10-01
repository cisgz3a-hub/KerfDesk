import type { StatusReport } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import {
  connectWith,
  makeConnection,
  type FakeConnection,
} from '../state/laser-store-motion-operation.test-support';
import { installFramedRunPermitForCurrentState } from './framed-run-testing';

const originalStartJob = useLaserStore.getState().startJob;

export const CLAIM_TEST_IDLE_STATUS: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

export async function installConnectedFramedRun(
  write?: (data: string) => Promise<void>,
  startJob = originalStartJob,
) {
  const connection: FakeConnection = makeConnection(
    write ??
      (async (data) => {
        if (data === '?') {
          setTimeout(() => {
            connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
          }, 0);
        }
      }),
    undefined,
    { autoAckStartFence: true },
  );
  useLaserStore.setState({ ...initialLaserState(), startJob });
  await connectWith(connection);
  const controllerSessionEpoch = useLaserStore.getState().controllerSessionEpoch;
  useLaserStore.setState({
    statusReport: CLAIM_TEST_IDLE_STATUS,
    controllerOperation: null,
    pendingUntrackedAcks: 0,
    controllerSettings: { maxPowerS: 1000, laserModeEnabled: true },
    controllerSettingsObservation: { sessionEpoch: controllerSessionEpoch, observedAt: 1 },
    controllerQualification: {
      kind: 'qualified',
      epoch: controllerSessionEpoch,
      settings: 'verified',
    },
  });
  const permit = await installFramedRunPermitForCurrentState();
  return { connection, verification: permit.candidate.frameVerification };
}
