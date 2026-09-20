import { describe, expect, it } from 'vitest';
import { selectControllerDriver } from './select-controller-driver';
import { grblDriver } from './grbl/driver';

const commandSet = 'creality-falcon-a1-pro';

describe('Falcon A1 Pro vendor command contract', () => {
  it('keeps generic controller commands unchanged and scopes the override to GRBL families', () => {
    expect(selectControllerDriver('grbl-v1.1')).toBe(grblDriver);
    expect(grblDriver.commands.settingsQuery).toBe('$$');
    expect(grblDriver.commands.home).toBe('$H');
    expect(grblDriver.commands.frameToolOffLines).toEqual(['M5', 'M9']);
    for (const kind of ['fluidnc', 'marlin', 'smoothieware', 'ruida'] as const) {
      expect(selectControllerDriver(kind, commandSet)).toBe(selectControllerDriver(kind));
    }
  });

  it('does not offer unsupported settings fetch, firmware writes, or native jog cancellation', () => {
    const driver = selectControllerDriver('grblhal', commandSet);
    expect(driver.commands.settingsQuery).toBeNull();
    expect(driver.capabilities.settings).toBe('none');
    expect(driver.capabilities.firmwareSetupPanel).toBe('none');
    expect(driver.capabilities.jogCancel).toBe(false);
    expect(driver.realtime.jogCancel).toBeNull();
    expect(driver.commands.home).toBe('$HX\n$HY');
    expect(driver.consoleQuickCommands.some(({ command }) => command === '$$')).toBe(false);
    expect(driver.prepareConsoleCommand('$HZ1')).toMatchObject({
      ok: true,
      command: { stateEffect: 'reference' },
    });
  });

  it('uses finite tool-off feed-controlled G1 jogs and restores absolute mode', () => {
    const { buildJog } = selectControllerDriver('grblhal', commandSet).commands;
    expect(buildJog({ dx: -2, dy: 0, feed: 500.9 })).toBe('M5\nG21 G91\nG1 X-2.000 F500 S0\nG90');
    expect(buildJog({ dx: 0, dy: 4, relative: false, feed: 0.5 })).toBe(
      'M5\nG21 G90\nG1 X0.000 Y4.000 F0.5 S0',
    );
    expect(() => buildJog({ dx: Infinity, feed: 500 })).toThrow(/finite/);
    expect(() => buildJog({ dx: 2, feed: NaN })).toThrow(/finite/);
    expect(() => buildJog({ dx: 0, feed: 500 })).toThrow(/axis/);
  });

  it('frames with zero-power G1 lines instead of native $J commands and leaves the pump alone', () => {
    const driver = selectControllerDriver('grblhal', commandSet);
    const lines = driver.commands.buildFrameLines({ minX: 0, minY: 1, maxX: 10, maxY: 5 }, 500);
    // ADR-323: laser-off only. An M9 here put the A1 pump into its standby
    // state right before Start, so the opening operation burned without air.
    expect(driver.commands.frameToolOffLines).toEqual(['M5']);
    expect(lines).toEqual([
      'G21 G90\n',
      'G1 X0.000 Y1.000 F500 S0\n',
      'G1 X10.000 Y1.000 F500 S0\n',
      'G1 X10.000 Y5.000 F500 S0\n',
      'G1 X0.000 Y5.000 F500 S0\n',
      'G1 X0.000 Y1.000 F500 S0\n',
    ]);
    expect(() =>
      driver.commands.buildFrameLines({ minX: 0, minY: 1, maxX: NaN, maxY: 5 }, 500),
    ).toThrow(/finite/);
  });
});
