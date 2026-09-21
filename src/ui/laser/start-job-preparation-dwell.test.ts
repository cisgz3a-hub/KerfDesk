import { describe, expect, it } from 'vitest';
import type { ControllerKind } from '../../core/devices';
import type { Job } from '../../core/job';
import { cncGrblStrategy } from '../../core/output/cnc-grbl-strategy';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { DWELL_EVIDENCE_UNAVAILABLE_REASON } from '../state/canvas-job-timing-plan';
import { okPreparation } from './start-job-preparation';

function prepare(
  options: {
    readonly segments?: number;
    readonly position?: 'known' | 'missing' | 'no-report';
    readonly connected?: boolean;
    readonly active?: ControllerKind | null;
    readonly detected?: ControllerKind | null;
    readonly dwell?: number;
  } = {},
) {
  const project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
  const job: Job = {
    groups: [
      {
        kind: 'cnc',
        layerId: 'L',
        color: '#ff0000',
        cutType: 'profile-on-path',
        toolDiameterMm: 3.175,
        feedMmPerMin: 1200,
        plungeMmPerMin: 60,
        spindleRpm: 12000,
        spindleSpinupSec: options.dwell ?? 3,
        safeZMm: 5,
        passes: [
          {
            kind: 'contour',
            zMm: -1,
            closed: false,
            polyline: Array.from({ length: (options.segments ?? 2) + 1 }, (_, index) => ({
              x: index % 2,
              y: 10,
            })),
          },
        ],
      },
    ],
  };
  const gcode = cncGrblStrategy.emit(job, project.device);
  const active = options.active === undefined ? 'grbl-v1.1' : options.active;
  const result = okPreparation(
    gcode,
    [],
    undefined,
    [],
    { ok: true, project, job, jobOriginOffset: { x: 0, y: 0 } },
    {
      connected: options.connected ?? true,
      statusReport:
        options.position === 'no-report'
          ? null
          : {
              state: 'Idle',
              subState: null,
              mPos: options.position === 'missing' ? null : { x: 0, y: 0, z: 0 },
              wPos: null,
              feed: 0,
              spindle: 0,
              wco: null,
            },
      alarmCode: null,
      hasActiveStreamer: false,
      ...(active === null ? {} : { activeControllerKind: active }),
      detectedControllerKind: options.detected ?? null,
      controllerSessionEpoch: 7,
      trustedPositionEpoch: 7,
    },
    undefined,
    false,
    'dwell-fallback',
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.messages.join('\n'));
  return result;
}

describe('prepared estimates preserve connected dwell uncertainty', () => {
  it.each([
    ['short program', {}],
    ['line budget exceeded', { segments: 25_001 }],
    ['no reported position', { position: 'missing' }],
    ['connected before the first report', { position: 'no-report' }],
    ['no active controller identity', { active: null }],
    [
      'millisecond controller above the line budget',
      {
        segments: 25_001,
        active: 'marlin',
        detected: 'marlin',
      },
    ],
  ] as const)('keeps the estimate unavailable for %s', (_label, options) => {
    const result = prepare(options);
    expect(result.gcode).toContain('G4 P3.000');
    expect(result.metrics.duration.unavailableReason).toBe(DWELL_EVIDENCE_UNAVAILABLE_REASON);
  });

  it('keeps a large-job estimate when dwell units are proven', () => {
    const result = prepare({ segments: 25_001, detected: 'grbl-v1.1' });
    expect(result.metrics.duration.unavailableReason).toBeUndefined();
    expect(result.metrics.duration.breakdown.dwellSeconds).toBe(3);
  });

  it('keeps offline estimates using profile assumptions', () => {
    const result = prepare({ connected: false, position: 'no-report' });
    expect(result.metrics.duration.unavailableReason).toBeUndefined();
    expect(result.metrics.duration.breakdown.dwellSeconds).toBe(3);
  });

  it('does not discard a connected fallback estimate without dwell', () => {
    const result = prepare({ dwell: 0, position: 'missing' });
    expect(result.gcode).not.toContain('G4');
    expect(result.metrics.duration.unavailableReason).toBeUndefined();
    expect(result.metrics.duration.totalSeconds).toBeGreaterThan(0);
  });
});
