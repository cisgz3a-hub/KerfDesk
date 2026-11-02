// The controllers and programs the in-window stall test runs (rolling audit v6
// K1, ADR-676; `stall-thread-harness.ts` runs them).

import type { ControllerKind, DeviceProfile } from '../../core/devices';
import type { Job } from '../../core/job';
import { grblStrategy } from '../../core/output/grbl-strategy';
import { marlinStrategy } from '../../core/output/marlin-strategy';
import type { StallThreadConfig } from './stall-thread-entry';

// A fine zigzag engrave: 0.28 mm moves at 1,500 mm/min, about 11 ms each, so
// the 16-block Marlin planner holds under 0.2 s (the audit's engrave case).
function engraveJob(segments: number): Job {
  return {
    groups: [
      {
        kind: 'cut',
        layerId: 'L1',
        color: '#ff0000',
        power: 80,
        speed: 1500,
        passes: 1,
        airAssist: false,
        segments: [
          {
            polyline: Array.from({ length: segments + 1 }, (_, i) => ({
              x: 10 + i * 0.2,
              y: 50 + (i % 2) * 0.2,
            })),
            closed: false,
          },
        ],
      },
    ],
  };
}

export type StallCase = {
  readonly firmware: StallThreadConfig['firmware'];
  readonly controllerKind: ControllerKind;
  readonly device: Partial<DeviceProfile>;
  readonly program: (device: DeviceProfile) => string;
  readonly streamingMode?: 'ping-pong';
  readonly stallMs: number;
};

// Two 30 mm cuts joined by a 42 mm travel: the audit's case, where a skipped
// beam-off burns that travel across the workpiece (rolling audit v9 R1-P1-1).
function twoCutJob(): Job {
  const cut = (y: number) => ({
    polyline: [
      { x: 10, y },
      { x: 40, y },
    ],
    closed: false,
  });
  return {
    groups: [
      {
        kind: 'cut',
        layerId: 'L1',
        color: '#ff0000',
        power: 80,
        speed: 1500,
        passes: 1,
        airAssist: false,
        segments: [cut(50), cut(80)],
      },
    ],
  };
}

export const MARLIN_INLINE: StallCase = {
  firmware: 'marlin',
  controllerKind: 'marlin',
  device: {
    controllerKind: 'marlin',
    maxPowerS: 255,
    gcodeDialect: { dialectId: 'marlin-inline' },
  },
  program: (device) => marlinStrategy.emit(engraveJob(360), device),
  streamingMode: 'ping-pong',
  stallMs: 1_600,
};
export const MARLIN_FAN: StallCase = {
  ...MARLIN_INLINE,
  device: { controllerKind: 'marlin', maxPowerS: 255, gcodeDialect: { dialectId: 'marlin-fan' } },
};
export const MARLIN_INLINE_TWO_CUTS: StallCase = {
  ...MARLIN_INLINE,
  program: (device) => marlinStrategy.emit(twoCutJob(), device),
};
export const MARLIN_FAN_TWO_CUTS: StallCase = {
  ...MARLIN_FAN,
  program: (device) => marlinStrategy.emit(twoCutJob(), device),
};
export const GRBL_COMPATIBLE: StallCase = {
  firmware: 'grbl',
  controllerKind: 'grbl-v1.1',
  device: { controllerKind: 'grbl-v1.1', gcodeDialect: { dialectId: 'grbl-compatible' } },
  program: (device) => grblStrategy.emit(engraveJob(420), device),
  stallMs: 1_000,
};
export const GRBLHAL_COMPATIBLE: StallCase = {
  ...GRBL_COMPATIBLE,
  firmware: 'grblhal',
  controllerKind: 'grblhal',
  device: { controllerKind: 'grblhal', gcodeDialect: { dialectId: 'grbl-compatible' } },
};
