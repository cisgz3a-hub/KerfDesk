import { afterEach, describe, expect, it } from 'vitest';
import type { GrblBuildInfo } from '../../core/controllers/grbl/build-info';
import { FRAME_CONTROLLER_CHANGED_MESSAGE } from './framed-run';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { resetStore } from './test-helpers';
import {
  acknowledgeAndSettleFrameLeg,
  acknowledgeFrameToolOffPrelude,
  acknowledgeMotionSettlement,
  connectWith,
  framedRunCandidate,
  makeConnection,
} from './laser-store-motion-operation.test-support';

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  resetStore();
});

describe('Frame completion across controller evidence refresh', () => {
  it.each(['unchanged', 'equivalent', 'report-units'])(
    'retains terminal settlement and factual units for %s evidence',
    async (refresh) => {
      const connection = makeConnection(async () => undefined);
      await connectWith(connection);
      const sessionEpoch = useLaserStore.getState().controllerSessionEpoch;
      const controllerSettings = { maxPowerS: 1000, laserModeEnabled: true, reportInches: false };
      const controllerBuildInfo: GrblBuildInfo = {
        protocolVersion: '1.1h',
        buildRevision: '20190830',
        userInfo: '',
        optionCodes: ['V', 'N', 'M'],
        plannerBufferBlocks: 15,
        rxBufferBytes: 128,
      };
      useLaserStore.setState({
        controllerSettings,
        controllerSettingsObservation: { sessionEpoch, observedAt: 100 },
        controllerBuildInfo,
        controllerBuildInfoObservation: { sessionEpoch, observedAt: 100 },
      });
      const candidate = { ...framedRunCandidate(), returnToWorkPosition: { x: 0, y: 0 } };
      await useLaserStore
        .getState()
        .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, candidate);
      await acknowledgeFrameToolOffPrelude(connection);
      for (let leg = 0; leg < 4; leg += 1) await acknowledgeAndSettleFrameLeg(connection);

      if (refresh !== 'unchanged') {
        useLaserStore.setState({
          controllerSettings: { ...controllerSettings, reportInches: refresh === 'report-units' },
          controllerSettingsObservation: { sessionEpoch, observedAt: 101 },
          controllerBuildInfo: {
            ...controllerBuildInfo,
            optionCodes: [...controllerBuildInfo.optionCodes],
          },
          controllerBuildInfoObservation: { sessionEpoch, observedAt: 101 },
        });
      }
      connection.emitLine('<Jog|MPos:0.000,0.000,0.000|FS:1000,0>');
      connection.emitLine('ok');
      connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
      expect(useLaserStore.getState().framedRun).toBeNull();
      expect(useLaserStore.getState().motionOperation).not.toBeNull();
      await acknowledgeMotionSettlement(connection);

      const finished = useLaserStore.getState();
      expect(finished.motionOperation).toBeNull();
      if (refresh === 'report-units') {
        expect(finished.framedRun).toBeNull();
        expect(finished.frameVerification).toBeNull();
        expect(finished.lastWriteError).toBe(FRAME_CONTROLLER_CHANGED_MESSAGE);
      } else {
        expect(finished.framedRun?.candidate).toBe(candidate);
        expect(finished.frameVerification).toBe(candidate.frameVerification);
        expect(finished.lastWriteError).toBeNull();
      }
    },
  );
});
