/* eslint-disable no-restricted-syntax -- Fixture colours identify scene artwork layers, not UI chrome. */
import { expect, vi } from 'vitest';
import {
  createGrblSimulator,
  createMarlinSimulator,
  createSmoothieSimulator,
} from '../../__fixtures__/controllers';
import type { ControllerKind, Origin } from '../../core/devices/device-profile';
import type { JobStartMode } from '../../core/job';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { connectOptionsForDevice } from '../commands/connect-options';
import { startTestLaserJobOnClock } from '../state/laser-test-command-control';
import { useStore } from '../state/store';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from '../state/laser-store';
import { RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import { runStartJobFlow } from './start-job-flow';

export async function startReviewedFrameOnClock() {
  const repository = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => '2026-10-18T12:00:00.000Z',
  });
  const disposeReview = installAutoJobReview('confirm');
  try {
    const starting = runStartJobFlow(repository);
    await vi.advanceTimersByTimeAsync(12_000);
    await starting;
    await vi.advanceTimersByTimeAsync(5_000);
    return repository;
  } finally {
    disposeReview();
    useJobReviewStore.getState().close();
  }
}

export function expectProgramSentOnce(payloads: ReadonlyArray<string>, gcode: string): void {
  const lines = (value: string) =>
    value
      .split(/\r?\n/)
      .map((line) => (line.replace(/\([^)]*\)/g, '').split(';')[0] ?? '').trim())
      .filter(Boolean);
  const expected = lines(gcode);
  const sent = lines(
    [...payloads.join('')]
      .filter((character) => character !== '?' && character.charCodeAt(0) < 0x80)
      .join(''),
  );
  const starts = sent.flatMap((_line, index) =>
    expected.every((command, offset) => sent[index + offset] === command) ? [index] : [],
  );
  expect(
    starts,
    'The exact prepared program must cross the real serial handoff once.',
  ).toHaveLength(1);
}

/** Fault only delivery of the first terminal ACK after Frame's completion
 * report. Firmware motion and all status interpretation stay real. */
export function holdCompletedFrameAck(adapter: PlatformAdapter) {
  let armed = false;
  let release: (() => void) | null = null;
  const decorate = (connection: SerialConnection): SerialConnection => ({
    ...connection,
    onLine: (handler) =>
      connection.onLine((line) => {
        if (armed && useLaserStore.getState().framedRun !== null && /^ok\b/.test(line)) {
          armed = false;
          release = () => handler(line);
        } else handler(line);
      }),
  });
  return {
    adapter: {
      ...adapter,
      serial: {
        ...adapter.serial,
        requestPort: async () => {
          const port = await adapter.serial.requestPort();
          return port === null
            ? null
            : {
                ...port,
                open: async (options) => decorate(await port.open(options)),
              };
        },
      },
    } satisfies PlatformAdapter,
    arm: () => {
      armed = true;
    },
    held: () => release !== null,
    release: () => {
      const deliver = release;
      release = null;
      deliver?.();
    },
  };
}

function artwork(id: string, x: number, y: number, color = '#ff0000'): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: x, minY: y, maxX: x + 20, maxY: y + 10 },
    paths: [
      {
        color,
        polylines: [
          {
            closed: false,
            points: [
              { x, y },
              { x: x + 20, y: y + 10 },
            ],
          },
        ],
      },
    ],
  };
}

function projectFor(kind: ControllerKind, origin: Origin): Project {
  const base = createProject();
  return {
    ...base,
    device: {
      ...base.device,
      controllerKind: kind,
      ...(kind === 'marlin' ? { gcodeDialect: { dialectId: 'marlin-inline' as const } } : {}),
      origin,
      homing: { ...base.device.homing, enabled: false },
      maxPowerS: kind === 'smoothieware' ? 1 : 1000,
      // The fixture explicitly maps its auxiliary output. These commands are
      // never a proposed default for any physical machine's positioning LED.
      positioningLight: {
        onCommand: 'M7',
        offCommand: 'M9',
        offsetXmm: 7,
        offsetYmm: -4,
        afterFrame: true,
      },
    },
    scene: {
      ...EMPTY_SCENE,
      layers: [
        { ...createLayer({ id: 'output', color: '#ff0000' }), power: 10 },
        { ...createLayer({ id: 'disabled', color: '#0000ff' }), output: false },
      ],
      // Output bounds are 30..80 by 40..70, centre 55,55. Selection is only
      // the first object, while the disabled object must not affect centring.
      objects: [
        artwork('selected', 30, 40),
        artwork('also-output', 60, 60),
        artwork('disabled', 300, 300, '#0000ff'),
      ],
    },
  };
}

export async function connectedFixture(
  kind: ControllerKind,
  mode: JobStartMode,
  origin: Origin = 'front-left',
) {
  const project = projectFor(kind, origin);
  useStore.setState({
    project,
    selectedObjectId: 'selected',
    jobPlacement: { startFrom: mode, anchor: 'front-left' },
  });
  const sim =
    kind === 'marlin'
      ? createMarlinSimulator({ motionMs: 25 })
      : kind === 'smoothieware'
        ? createSmoothieSimulator({ motionMs: 25 })
        : createGrblSimulator({
            motionMs: 25,
            settings: [
              [22, '0'],
              [32, '1'],
            ],
          });
  const frameAck = holdCompletedFrameAck(sim.adapter);
  await useLaserStore.getState().connect(frameAck.adapter, connectOptionsForDevice(project.device));
  await vi.advanceTimersByTimeAsync(2_000);
  const jogging = useLaserStore.getState().jog({ dx: 100, dy: 50, feed: 1000 });
  await vi.advanceTimersByTimeAsync(2_000);
  await jogging;
  const originSetting = useLaserStore.getState().setOriginHere();
  await vi.advanceTimersByTimeAsync(2_000);
  await originSetting;
  await startTestLaserJobOnClock('G21\nG90\nG0 X75 Y45\nM5\n', { streamingMode: 'ping-pong' });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(useLaserStore.getState().wcoCache).toEqual({ x: 100, y: 50, z: 0 });
  return { project, sim, frameAck };
}
