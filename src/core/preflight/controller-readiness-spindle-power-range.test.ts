// ADR-567 Amendment 3: a CNC/router job warns in Job Review when the
// controller's $30 is not above $31. Stock GRBL then runs the spindle at full
// speed even at S0; grblHAL falls back to on/off spindle control. A $30 that
// already mismatches the spindle max RPM is not named twice unless fixing that
// mismatch would still leave the range empty.

import { describe, expect, it } from 'vitest';
import type { ControllerKind } from '../devices';
import { settingsMapToControllerSettings } from '../controllers/grbl/parse-settings';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject } from '../scene';
import { runControllerReadiness } from './controller-readiness';

const cncProject = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
const MAX_RPM = DEFAULT_CNC_MACHINE_CONFIG.params.spindleMaxRpm;

function dump(entries: ReadonlyArray<readonly [number, string]>) {
  return settingsMapToControllerSettings(new Map(entries));
}

function readiness(
  entries: ReadonlyArray<readonly [number, string]>,
  firmware?: ControllerKind,
): ReturnType<typeof runControllerReadiness> {
  return runControllerReadiness(cncProject, dump(entries), 'grbl-dollar', firmware);
}

function codes(result: ReturnType<typeof runControllerReadiness>): ReadonlyArray<string> {
  return [...result.errors, ...result.warnings].map((issue) => issue.code);
}

function rangeMessage(result: ReturnType<typeof runControllerReadiness>): string | undefined {
  return result.warnings.find((warning) => warning.code === 'power-range-empty')?.message;
}

// $30 matches the spindle profile, so no mismatch error hides the empty range.
const equalRange = [
  [30, String(MAX_RPM)],
  [31, String(MAX_RPM)],
  [32, '0'],
] as const;

describe('CNC power-range-empty Job Review warning', () => {
  it('says a stock GRBL spindle runs at full speed even at S0', () => {
    const result = readiness(equalRange, 'grbl-v1.1');
    expect(codes(result)).toEqual(['power-range-empty']);
    expect(result.ok).toBe(true);
    expect(rangeMessage(result)).toBe(
      `Controller $30=${MAX_RPM} is not above $31=${MAX_RPM}, so there is no S spindle speed range. Stock GRBL then drives full PWM for every S, so the spindle runs at full speed even at S0 while M3 or M4 is on. Set $30=${MAX_RPM}, the spindle's max RPM, with $31 below it before cutting.`,
    );
  });

  it('says grblHAL falls back to on/off spindle control, not full speed', () => {
    const message = rangeMessage(readiness(equalRange, 'grblhal'));
    expect(message).toContain(
      'grblHAL then switches to on/off spindle control, so S no longer sets the spindle RPM.',
    );
    expect(message).not.toContain('full speed');
    expect(message).not.toContain('laser');
  });

  it('states both firmwares when the connected one is unknown', () => {
    const message = rangeMessage(readiness(equalRange));
    expect(message).toContain('Stock GRBL then drives full PWM for every S');
    expect(message).toContain('grblHAL instead switches to on/off spindle control');
  });

  it('names a $31 at or above the spindle max even when $30 also mismatches', () => {
    const result = readiness(
      [
        [30, '1000'],
        [31, String(MAX_RPM)],
        [32, '0'],
      ],
      'grbl-v1.1',
    );
    expect(codes(result)).toEqual(['spindle-scale-mismatch', 'power-range-empty']);
    expect(rangeMessage(result)).toContain(`$30=1000 is not above $31=${MAX_RPM}`);
  });

  it('leaves a $30=0 to the spindle-scale mismatch, whose fix restores the range', () => {
    for (const firmware of ['grbl-v1.1', 'grblhal', undefined] as const) {
      const result = readiness(
        [
          [30, '0'],
          [31, '0'],
          [32, '0'],
        ],
        firmware,
      );
      expect(codes(result)).toEqual(['spindle-scale-mismatch']);
    }
  });

  it('stays quiet for a usable range, including a raised spindle minimum', () => {
    expect(
      codes(
        readiness(
          [
            [30, String(MAX_RPM)],
            [31, '3000'],
            [32, '0'],
          ],
          'grbl-v1.1',
        ),
      ),
    ).toEqual([]);
  });

  it('is a warning even when Start would show the other readiness errors', () => {
    const result = readiness(
      [
        [30, String(MAX_RPM)],
        [31, String(MAX_RPM + 1)],
        [32, '1'],
      ],
      'grblhal',
    );
    expect(result.errors.map((issue) => issue.code)).toEqual(['laser-mode-enabled']);
    expect(result.warnings.map((issue) => issue.code)).toEqual(['power-range-empty']);
  });
});
