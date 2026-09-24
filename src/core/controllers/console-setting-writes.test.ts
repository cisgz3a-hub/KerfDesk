import { describe, expect, it } from 'vitest';
import type { ControllerDriver } from './controller-driver';
import { consoleSettingWriteIssue } from './console-setting-writes';
import { selectControllerDriver } from './select-controller-driver';

const falcon = selectControllerDriver('grblhal', 'creality-falcon-a1-pro');
const grblHal = selectControllerDriver('grblhal');
const fluidnc = selectControllerDriver('fluidnc');

function issue(driver: ControllerDriver, input: string): string | null {
  const prepared = driver.prepareConsoleCommand(input);
  if (!prepared.ok) throw new Error(prepared.reason);
  return consoleSettingWriteIssue(driver, prepared.command);
}

describe('Console numeric setting writes (ADR-366)', () => {
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
