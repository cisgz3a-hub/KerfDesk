import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import type { Job } from '../../../core/job';
import { grblStrategy } from '../../../core/output/grbl-strategy';
import { createLayer } from '../../../core/scene';
import { detectAirAssistCyclingWarnings } from './air-assist-cycling-warnings';

function cutGroup(layerId: string, airAssist: boolean): Job['groups'][number] {
  return {
    kind: 'cut',
    layerId,
    color: '#000000',
    power: 30,
    speed: 1000,
    passes: 1,
    airAssist,
    segments: [
      {
        closed: false,
        polyline: [
          { x: 1, y: 1 },
          { x: 5, y: 1 },
        ],
      },
    ],
  };
}

/** Air on, air off, air on: the only shape that is ever bridged. */
function sandwichJob(): Job {
  return {
    groups: [cutGroup('a', true), cutGroup('b', false), cutGroup('c', true)],
  };
}

function namedLayer(id: string, name: string) {
  return { ...createLayer({ id, color: '#000000' }), name };
}

const UNRELIABLE = {
  ...DEFAULT_DEVICE_PROFILE,
  airAssistCommand: 'M8',
  airAssistRestartUnreliable: true,
} as const;

describe('detectAirAssistCyclingWarnings (ADR-335)', () => {
  it('says nothing on a controller whose air restarts normally', () => {
    expect(
      detectAirAssistCyclingWarnings(sandwichJob(), {
        ...DEFAULT_DEVICE_PROFILE,
        airAssistCommand: 'M8',
      }),
    ).toEqual([]);
  });

  it('says nothing when the device has no air output wired', () => {
    expect(
      detectAirAssistCyclingWarnings(sandwichJob(), {
        ...UNRELIABLE,
        airAssistCommand: 'none',
      }),
    ).toEqual([]);
  });

  it('says nothing when no Air-off operation sits between two Air-on ones', () => {
    const trailing: Job = { groups: [cutGroup('a', true), cutGroup('b', false)] };
    const leading: Job = { groups: [cutGroup('a', false), cutGroup('b', true)] };

    expect(detectAirAssistCyclingWarnings(trailing, UNRELIABLE)).toEqual([]);
    expect(detectAirAssistCyclingWarnings(leading, UNRELIABLE)).toEqual([]);
  });

  it('names the bridged operation and the controller setting that removes the hold', () => {
    const warnings = detectAirAssistCyclingWarnings(sandwichJob(), UNRELIABLE, [
      namedLayer('b', 'Score lines'),
    ]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Score lines');
    expect(warnings[0]).toContain('$152=0');
    expect(warnings[0]).toContain('Air assist stays on');
  });

  it('falls back to the operation id when the layers are not supplied', () => {
    const warnings = detectAirAssistCyclingWarnings(sandwichJob(), UNRELIABLE);

    expect(warnings[0]).toContain('b');
  });

  it('lists several bridged operations together', () => {
    const job: Job = {
      groups: [
        cutGroup('a', true),
        cutGroup('b', false),
        cutGroup('c', false),
        cutGroup('d', true),
      ],
    };

    const warnings = detectAirAssistCyclingWarnings(job, UNRELIABLE, [
      namedLayer('b', 'Score'),
      namedLayer('c', 'Engrave'),
    ]);

    expect(warnings[0]).toContain('Score and Engrave');
  });

  it('warns exactly when the emitter actually held the air on', () => {
    // The advisory and the emitted bytes read the same rule, so this pins that
    // the operator is never told about a hold that did not happen, and never
    // left unaware of one that did.
    const cases: ReadonlyArray<{ readonly job: Job; readonly bridged: boolean }> = [
      { job: sandwichJob(), bridged: true },
      { job: { groups: [cutGroup('a', true), cutGroup('b', false)] }, bridged: false },
      { job: { groups: [cutGroup('a', false), cutGroup('b', true)] }, bridged: false },
      { job: { groups: [cutGroup('a', true), cutGroup('b', true)] }, bridged: false },
    ];

    for (const { job, bridged } of cases) {
      const warned = detectAirAssistCyclingWarnings(job, UNRELIABLE).length > 0;
      const coolant = grblStrategy
        .emit(job, UNRELIABLE)
        .split('\n')
        .filter((line) => line === 'M8' || line === 'M9');
      const cycled = coolant.length > 2;

      expect(warned, JSON.stringify(coolant)).toBe(bridged);
      // A bridged job emits one M8 and one M9; cycling would emit more.
      expect(cycled).toBe(false);
    }
  });
});
