// ADR-695 against the GRBL simulator with the real store, Frame and Start:
// - a four-axis grblHAL with the rotary on A frames and burns by turning A,
//   zeroed first with G92 A0, and the head never moves in Y;
// - a stock three-axis GRBL with the rotary on the Y port (Y swap) frames and
//   burns on Y, with no A word and no G92, as before.

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile, type RotarySetup } from '../../core/devices';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import {
  drive,
  harness,
  installRecoveryStressHooks,
  programLines,
  startFramedJob,
  STRESS_TIMEOUT_MS,
  tick,
} from './recovery-stress-testing';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

installRecoveryStressHooks();

const ORIGIN = { x: 20, y: 30 };
const DIAMETER = 60;
const TALL_MM = 20;

function rotaryProject(device: DeviceProfile): Project {
  const project = createProject(device);
  const color = '#ff0000';
  return {
    ...project,
    scene: {
      ...EMPTY_SCENE,
      layers: [{ ...createLayer({ id: 'red', color }), power: 30, airAssist: false }],
      objects: [
        {
          kind: 'imported-svg',
          id: 'square',
          source: 'square.svg',
          bounds: { minX: 4, minY: 4, maxX: 24, maxY: 4 + TALL_MM },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color,
              polylines: [
                {
                  closed: true,
                  points: [
                    { x: 4, y: 4 },
                    { x: 24, y: 4 },
                    { x: 24, y: 4 + TALL_MM },
                    { x: 4, y: 4 + TALL_MM },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

async function setOriginAtOrigin(): Promise<void> {
  await drive(useLaserStore.getState().jog({ dx: ORIGIN.x, dy: ORIGIN.y, feed: 3_000 }));
  await tick(1_500);
  await drive(useLaserStore.getState().setOriginHere());
  await tick(1_500);
}

function values(lines: ReadonlyArray<string>, letter: string): number[] {
  const pattern = new RegExp(`${letter}(-?\\d+(?:\\.\\d+)?)`);
  return lines.flatMap((line) => {
    if (line.startsWith('G92')) return [];
    const match = pattern.exec(line.replace(/;.*$/, ''));
    return match === null ? [] : [Number(match[1])];
  });
}

describe('rotary on a dedicated A axis, four-axis grblHAL simulator', () => {
  it(
    'frames and burns by turning A, with the head held at its own Y',
    async () => {
      const rotary: RotarySetup = {
        enabled: true,
        type: 'chuck',
        axis: 'A',
        axisConfirmed: 'A',
        mmPerRotation: 360,
        objectDiameterMm: DIAMETER,
      };
      const h = await harness({
        simulator: {
          firmware: 'grblhal',
          firmwareBanner: "GrblHAL 1.1f ['$' or '$HELP' for help]",
          fourthAxisA: true,
        },
        project: rotaryProject({ ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grblhal', rotary }),
      });
      expect(useLaserStore.getState().statusReport?.reportedAxisCount).toBe(4);
      useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' } });
      await setOriginAtOrigin();
      const headY = h.simulator.state().mpos.y;
      const before = h.simulator.outbound().length;

      const { running } = await startFramedJob(h.repository);
      await drive(running);
      await tick(1_500);

      const lines = programLines(h.simulator, before);
      const frame = lines.filter((line) => line.startsWith('$J='));
      expect(lines.filter((line) => line.startsWith('G92 A0')).length).toBe(2);
      expect(frame.length).toBeGreaterThan(0);
      expect(values(frame, 'Y')).toEqual([]);
      const degrees = (TALL_MM * 360) / (Math.PI * DIAMETER);
      expect(Math.max(...values(frame, 'A'))).toBeCloseTo(degrees, 2);
      const program = lines.filter((line) => /^G[01]\b/.test(line));
      expect(values(program, 'Y')).toEqual([]);
      expect(Math.max(...values(program, 'A'))).toBeCloseTo(degrees, 2);
      // The head never left its Y; the rotary is back at the turn it started on.
      expect(h.simulator.state().mpos.y).toBe(headY);
      expect(h.simulator.state().aAxis?.mpos).toBeCloseTo(h.simulator.state().aAxis?.g92 ?? NaN, 3);
      expect(useLaserStore.getState().lastWriteError).toBeNull();
    },
    STRESS_TIMEOUT_MS,
  );
});

describe('rotary on the Y port, stock three-axis GRBL simulator (Y swap)', () => {
  it(
    'frames and burns on Y with no A word and no G92',
    async () => {
      const rotary: RotarySetup = {
        enabled: true,
        type: 'chuck',
        mmPerRotation: 40,
        objectDiameterMm: DIAMETER,
      };
      const h = await harness({
        project: rotaryProject({ ...DEFAULT_DEVICE_PROFILE, rotary }),
      });
      expect(useLaserStore.getState().statusReport?.reportedAxisCount).toBe(3);
      useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' } });
      await setOriginAtOrigin();
      const before = h.simulator.outbound().length;

      const { running } = await startFramedJob(h.repository);
      await drive(running);
      await tick(1_500);

      const lines = programLines(h.simulator, before);
      expect(lines.some((line) => line.startsWith('G92'))).toBe(false);
      expect(values(lines, 'A')).toEqual([]);
      const program = lines.filter((line) => /^G1\b/.test(line));
      const turn = (TALL_MM * 40) / (Math.PI * DIAMETER);
      expect(Math.max(...values(program, 'Y'))).toBeCloseTo(turn, 2);
      expect(useLaserStore.getState().lastWriteError).toBeNull();
    },
    STRESS_TIMEOUT_MS,
  );
});
