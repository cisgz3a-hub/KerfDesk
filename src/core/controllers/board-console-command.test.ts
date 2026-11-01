// Rolling audit v5 J7-P1-2, ADR-375 Amendment 11: once the banner shows
// FluidNC, a GRBL-family profile reads a Console line as FluidNC runs it.
import { describe, expect, it } from 'vitest';
import { prepareBoardConsoleCommand } from './board-console-command';
import { fluidncDriver } from './fluidnc/driver';
import { grblDriver } from './grbl/driver';
import { grblHalDriver } from './grblhal/driver';
import { marlinDriver } from './marlin/driver';
import { selectControllerDriver } from './select-controller-driver';
import { smoothiewareDriver } from './smoothieware/driver';

const FLUIDNC = { detectedControllerKind: 'fluidnc' as const };
const FALCON = selectControllerDriver('grbl-v1.1', 'creality-falcon-a1-pro');

describe('prepareBoardConsoleCommand', () => {
  it.each([
    ['stock GRBL', grblDriver],
    ['grblHAL', grblHalDriver],
    ['Falcon A1 Pro', FALCON],
  ] as const)(
    'gives a bracket line the checks of the dollar form it runs as, under the %s profile',
    (_name, driver) => {
      expect(prepareBoardConsoleCommand(driver, '[13]1', FLUIDNC)).toEqual(
        driver.prepareConsoleCommand('$13=1'),
      );
      expect(prepareBoardConsoleCommand(driver, '[Report/Inches]1', FLUIDNC)).toEqual(
        driver.prepareConsoleCommand('$13=1'),
      );
      expect(prepareBoardConsoleCommand(driver, '[RST]#', FLUIDNC)).toEqual(
        driver.prepareConsoleCommand('$RST=#'),
      );
      expect(prepareBoardConsoleCommand(driver, '$Settings/Restore=#', FLUIDNC)).toEqual(
        driver.prepareConsoleCommand('$RST=#'),
      );
    },
  );

  it('sends the dollar form FluidNC runs, which the profile confirms and reads back', () => {
    const prepared = prepareBoardConsoleCommand(grblDriver, '[13]1', FLUIDNC);
    expect(prepared.ok && prepared.command).toMatchObject({
      kind: 'setting-write',
      normalized: '$13=1',
      wire: '$13=1\n',
      requiresConfirmation: true,
    });
  });

  it("refuses FluidNC's own erase and report_inches lines on a GRBL profile too", () => {
    for (const line of ['[NVX]', '$NVX', '$Settings/Erase']) {
      expect(prepareBoardConsoleCommand(grblDriver, line, FLUIDNC)).toMatchObject({
        ok: false,
        reason: expect.stringMatching(/erases every setting and work offset/),
      });
    }
    for (const line of ['$report_inches=on', '[report_inches]true']) {
      expect(prepareBoardConsoleCommand(grblDriver, line, FLUIDNC)).toMatchObject({
        ok: false,
        reason: expect.stringMatching(/report_inches switches FluidNC's position reports/),
      });
    }
  });

  it('leaves G-code and the profile reading alone when the banner shows no FluidNC', () => {
    expect(prepareBoardConsoleCommand(grblDriver, 'G0 X10', FLUIDNC)).toEqual(
      grblDriver.prepareConsoleCommand('G0 X10'),
    );
    for (const session of [null, undefined, { detectedControllerKind: 'grbl-v1.1' as const }]) {
      expect(prepareBoardConsoleCommand(grblDriver, '[13]1', session)).toEqual(
        grblDriver.prepareConsoleCommand('[13]1'),
      );
    }
  });

  it.each([
    ['FluidNC', fluidncDriver],
    ['Marlin', marlinDriver],
    ['Smoothieware', smoothiewareDriver],
  ] as const)(
    'keeps the %s profile reading, which a FluidNC banner does not change',
    (_name, driver) => {
      for (const line of ['[13]1', '[RST]#', 'G0 X10']) {
        expect(prepareBoardConsoleCommand(driver, line, FLUIDNC)).toEqual(
          driver.prepareConsoleCommand(line),
        );
      }
    },
  );
});
