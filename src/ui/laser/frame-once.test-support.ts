/* eslint-disable no-restricted-syntax -- Hex values here are artwork stroke colour scene data, not UI styling. */
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { useStore } from '../state';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { resetStore } from '../state/test-helpers';

export const FRAME_ONCE_IDLE: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  wco: { x: 0, y: 0, z: 0 },
  feed: 0,
  spindle: 0,
};

export function installFrameOnceProject(): void {
  resetStore();
  useStore.setState({
    project: {
      ...createProject({ ...DEFAULT_DEVICE_PROFILE, streamingMode: 'ping-pong' }),
      scene: {
        ...EMPTY_SCENE,
        layers: [createLayer({ id: 'red', color: '#ff0000' })],
        objects: [
          {
            kind: 'imported-svg',
            id: 'line-object',
            source: 'frame-once.svg',
            bounds: { minX: 1, minY: 1, maxX: 9, maxY: 9 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: '#ff0000',
                polylines: [
                  {
                    points: [
                      { x: 1, y: 1 },
                      { x: 9, y: 1 },
                      { x: 9, y: 9 },
                      { x: 1, y: 9 },
                      { x: 1, y: 1 },
                    ],
                    closed: true,
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
  });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: FRAME_ONCE_IDLE,
    wcoCache: { x: 0, y: 0, z: 0 },
    controllerSessionEpoch: 7,
    controllerQualification: { kind: 'qualified', epoch: 7, settings: 'verified' },
    controllerSettings: {
      maxPowerS: 1000,
      minPowerS: 0,
      laserModeEnabled: true,
    },
  });
}

export function frameOnceRepository(): RecoveryRepository {
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
}
