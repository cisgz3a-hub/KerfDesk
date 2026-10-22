// ADR-567 Amendment 1 (audit 03-P2-5): $30=0 is a reported value, and $30 at or
// below $31 leaves no S range. Stock GRBL then drives full PWM even at S0;
// grblHAL falls back to on/off spindle control. Job Review warns, Start is not
// refused.

import { describe, expect, it } from 'vitest';
import {
  laserPowerRangeIsEmpty,
  reportedMaxPowerS,
  settingsMapToControllerSettings,
  settingsMapToProfilePatch,
} from '../controllers/grbl/parse-settings';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject } from '../scene';
import { runControllerReadiness } from './controller-readiness';

function dump(entries: ReadonlyArray<readonly [number, string]>) {
  return settingsMapToControllerSettings(new Map(entries));
}

function codes(result: ReturnType<typeof runControllerReadiness>): ReadonlyArray<string> {
  return [...result.errors, ...result.warnings].map((issue) => issue.code);
}

function rangeMessage(result: ReturnType<typeof runControllerReadiness>): string | undefined {
  return result.warnings.find((warning) => warning.code === 'power-range-empty')?.message;
}

describe('$30=0 is a reported value', () => {
  it('records the zero report without putting it into a profile patch', () => {
    const map = new Map([
      [30, '0'],
      [31, '0'],
      [32, '1'],
    ]);
    const settings = settingsMapToControllerSettings(map);
    expect(settings.maxPowerS).toBeUndefined();
    expect(settings.maxPowerSReportedAsZero).toBe(true);
    expect(reportedMaxPowerS(settings)).toBe(0);
    expect(settingsMapToProfilePatch(map)).not.toHaveProperty('maxPowerS');
  });

  it('adds nothing to a dump with a positive or missing $30', () => {
    expect(dump([[30, '1000']])).not.toHaveProperty('maxPowerSReportedAsZero');
    expect(dump([[32, '1']])).not.toHaveProperty('maxPowerSReportedAsZero');
    expect(reportedMaxPowerS(dump([[32, '1']]))).toBeUndefined();
  });

  it('finds an empty range only when $30 is not above $31', () => {
    expect(laserPowerRangeIsEmpty(dump([[30, '0']]))).toBe(true);
    expect(
      laserPowerRangeIsEmpty(
        dump([
          [30, '1000'],
          [31, '1000'],
        ]),
      ),
    ).toBe(true);
    expect(
      laserPowerRangeIsEmpty(
        dump([
          [30, '1000'],
          [31, '1200'],
        ]),
      ),
    ).toBe(true);
    expect(
      laserPowerRangeIsEmpty(
        dump([
          [30, '1000'],
          [31, '999'],
        ]),
      ),
    ).toBe(false);
    expect(laserPowerRangeIsEmpty(dump([[30, '1']]))).toBe(false);
    expect(laserPowerRangeIsEmpty(dump([[32, '1']]))).toBe(false);
  });
});

describe('power-range-empty Job Review warning', () => {
  const laserProject = createProject();

  it('names full power at S0 for a stock GRBL $30=0, not an unconfirmed $30', () => {
    const settings = dump([
      [30, '0'],
      [31, '0'],
      [32, '1'],
    ]);
    const result = runControllerReadiness(laserProject, settings, 'grbl-dollar', 'grbl-v1.1');
    expect(codes(result)).toEqual(['power-range-empty']);
    expect(result.ok).toBe(true);
    expect(rangeMessage(result)).toContain('$30=0 is not above $31=0');
    expect(rangeMessage(result)).toContain('The controller fires full power even at S0');
  });

  it('replaces "may burn hotter" when $31 equals $30', () => {
    const settings = dump([
      [30, '1000'],
      [31, '1000'],
      [32, '1'],
    ]);
    const result = runControllerReadiness(laserProject, settings, 'grbl-dollar', 'grbl-v1.1');
    expect(codes(result)).toEqual(['power-range-empty']);
    expect(rangeMessage(result)).toContain('$30=1000 is not above $31=1000');
  });

  it('keeps the $31 advice for a nonzero $31 below $30', () => {
    const settings = dump([
      [30, '1000'],
      [31, '10'],
      [32, '1'],
    ]);
    expect(codes(runControllerReadiness(laserProject, settings))).toEqual(['min-power-nonzero']);
  });

  // Audit v4 E1-P3-2: stock GRBL maps S from $31 to $30, so a raised $31 burns
  // every power below 100% weaker (60% at 55.7%) and S at or below $31 at the
  // lowest PWM step. The old advice said low powers "may burn hotter".
  it('says a raised $31 burns weaker on stock GRBL and names $35 on grblHAL', () => {
    const settings = dump([
      [30, '1000'],
      [31, '100'],
      [32, '1'],
    ]);
    const minMessage = (firmware: 'grbl-v1.1' | 'grblhal' | undefined) =>
      runControllerReadiness(laserProject, settings, 'grbl-dollar', firmware).warnings.find(
        (warning) => warning.code === 'min-power-nonzero',
      )?.message;
    expect(minMessage('grbl-v1.1')).toBe(
      'Controller $31 minimum S is 100. Stock GRBL maps S from $31 up to $30, so every power below 100% burns weaker than set (50% runs at about 44%), and any S at or below $31 (powers up to 10%) fires only at the lowest PWM step, about 0.4%. Set $31=0 so power maps from zero.',
    );
    expect(minMessage('grblhal')).toContain('fires only at the $35 PWM minimum');
    expect(minMessage('grblhal')).toContain('A raised $35 lifts low powers instead.');
    expect(minMessage(undefined)).toContain("about 0.4% on stock GRBL, or grblHAL's $35");
    for (const firmware of ['grbl-v1.1', 'grblhal', undefined] as const) {
      expect(minMessage(firmware)).not.toContain('hotter');
    }
  });

  it('leaves out the shares when $30 was not reported', () => {
    const settings = dump([
      [31, '100'],
      [32, '1'],
    ]);
    const message = runControllerReadiness(
      laserProject,
      settings,
      'grbl-dollar',
      'grbl-v1.1',
    ).warnings.find((warning) => warning.code === 'min-power-nonzero')?.message;
    expect(message).toContain('burns weaker than set, and any S at or below $31 fires only');
  });

  it('describes grblHAL on/off spindle control instead of full power', () => {
    const settings = dump([
      [30, '1000'],
      [31, '1000'],
      [32, '1'],
    ]);
    const message = rangeMessage(
      runControllerReadiness(laserProject, settings, 'grbl-dollar', 'grblhal'),
    );
    expect(message).toContain('grblHAL then switches to on/off spindle control');
    expect(message).not.toContain('full power');
  });

  it('states both firmwares when the connected one is unknown', () => {
    const message = rangeMessage(
      runControllerReadiness(
        laserProject,
        dump([
          [30, '0'],
          [32, '1'],
        ]),
      ),
    );
    expect(message).toContain('Controller reports $30=0');
    expect(message).toContain('Stock GRBL then fires full power even at S0');
    expect(message).toContain('grblHAL instead switches to on/off spindle control');
  });

  it('points FluidNC at its speed_map', () => {
    const settings = dump([
      [30, '0'],
      [32, '1'],
    ]);
    const message = rangeMessage(
      runControllerReadiness(laserProject, settings, 'readonly-dump', 'fluidnc'),
    );
    expect(message).toContain('speed_map');
    expect(message).not.toContain('full power');
  });

  it('reports a CNC $30=0 as a spindle-scale mismatch, not a missing setting', () => {
    const project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
    const settings = dump([
      [30, '0'],
      [32, '0'],
    ]);
    const result = runControllerReadiness(project, settings);
    expect(codes(result)).toEqual(['spindle-scale-mismatch']);
    expect(result.errors[0]?.message).toContain('Controller $30 is 0');
  });
});
