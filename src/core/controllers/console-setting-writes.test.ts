import { describe, expect, it } from 'vitest';
import type { ControllerDriver } from './controller-driver';
import { consoleSettingWriteIssue } from './console-setting-writes';
import { selectControllerDriver } from './select-controller-driver';

const falcon = selectControllerDriver('grblhal', 'creality-falcon-a1-pro');
const grbl = selectControllerDriver('grbl-v1.1');
const grblHal = selectControllerDriver('grblhal');
const fluidnc = selectControllerDriver('fluidnc');

function issue(driver: ControllerDriver, input: string): string | null {
  const prepared = driver.prepareConsoleCommand(input);
  if (!prepared.ok) throw new Error(prepared.reason);
  return consoleSettingWriteIssue(driver, prepared.command);
}

describe('Console numeric setting writes (ADR-370)', () => {
  it('leaves a GRBL-settings driver free to send any numeric write', () => {
    expect(issue(grblHal, '$110=6000')).toBeNull();
  });

  it("sends Creality's documented air settings on the Falcon contract", () => {
    for (const input of ['$150=25', '$151=100', '$152=100', '$152=0', '$ 152 = 30']) {
      expect(issue(falcon, input), input).toBeNull();
    }
  });

  it('refuses an air setting outside its documented whole-number range', () => {
    expect(issue(falcon, '$152=101')).toBe(
      '$152 (air pump standby wait in seconds, 100 = never) takes a whole number from 0 to 100.',
    );
    expect(issue(falcon, '$151=50.5')).toContain('whole number from 0 to 100');
    expect(issue(falcon, '$150=-1')).toContain('whole number from 0 to 100');
  });

  it('keeps every other numeric write out of the Falcon contract', () => {
    expect(issue(falcon, '$110=36000')).toBe(
      `KerfDesk does not send numeric $ setting writes other than $150, $151 and $152 on the ${falcon.label} profile. Configure the controller with its own tools.`,
    );
  });

  it('keeps a driver without listed writes refusing them all', () => {
    expect(issue(fluidnc, '$30=1000')).toBe(
      `KerfDesk does not send numeric $ setting writes on the ${fluidnc.label} profile. Configure the controller with its own tools.`,
    );
  });

  it('judges only setting writes', () => {
    expect(issue(falcon, 'M8')).toBeNull();
  });
});

// Controller audit 2 (ADR-375), C-4: stock GRBL keeps its integer settings in
// 8 bits through `uint8_t int_value = trunc(value)` and still answers ok
// (grbl/settings.c#L229), so `$22=0.5` stored 0 and turned homing and soft
// limits off (#L275-L280). The value is read the way GRBL's line reader does.
describe('Console setting values stock GRBL would store differently', () => {
  it.each([
    ['$22=0.5', /\$22 is an on\/off setting: enter 0 or 1\. .*0\.5 would turn it off/],
    ['$22=.5', /enter 0 or 1/],
    ['$22 = 0 . 5 (half)', /0\.5 would turn it off/],
    ['$22=2', /enter 0 or 1\. GRBL would store 2 as 1\./],
    ['$23=1.9', /\$23 as a whole number from 0 to 255/],
    ['$1=300', /\$1 as a whole number from 0 to 255/],
    ['$10=511', /whole number from 0 to 255/],
  ])('refuses %j', (input, reason) => {
    expect(issue(grbl, input)).toMatch(reason);
  });

  it.each(['$22=1', '$22=1.0', '$1=255', '$32=0', '$110=500.5', '$22=1;x', '$22=1 (on)'])(
    'sends %j, which stock GRBL stores as typed',
    (input) => {
      expect(issue(grbl, input)).toBeNull();
    },
  );

  it.each(['$22=-1', '$20=abc', '$1=25x'])(
    'leaves %j to the firmware, which refuses it',
    (input) => {
      expect(issue(grbl, input)).toBeNull();
    },
  );

  it('leaves grblHAL, which refuses a fraction itself, to its firmware', () => {
    expect(issue(grblHal, '$22=0.5')).toBeNull();
  });
});
