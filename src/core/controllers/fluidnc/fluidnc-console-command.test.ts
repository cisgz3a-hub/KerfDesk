// FluidNC report commands only print configuration or lists (registered as
// ReportCommand in FluidNC ProcessSettings.cpp), so the Console must not treat
// them as a machine-state change that drops homing and Frame evidence (audit
// settings-console-7).
import { describe, expect, it } from 'vitest';
import { fluidncDriver } from './driver';

describe('FluidNC Console report commands', () => {
  it.each(['$CD', '$cd', '$Config/Dump', '$S', '$SC', '$L', '$CMD', '$SS'])(
    'prepares %s as a read-only report',
    (input) => {
      const prepared = fluidncDriver.prepareConsoleCommand(input);
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.command.stateEffect).toBe('read-only');
      expect(prepared.command.requiresIdle).toBe(false);
    },
  );

  it('keeps $CD=<file>, which writes a controller file, a mutation', () => {
    const prepared = fluidncDriver.prepareConsoleCommand('$CD=config.yaml');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.command.stateEffect).not.toBe('read-only');
  });
});
