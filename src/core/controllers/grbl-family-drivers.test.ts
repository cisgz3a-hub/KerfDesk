// The grblHAL and FluidNC drivers are deltas on the GRBL driver: identical
// wire vocabulary, distinct identity + capability overrides. These tests pin
// exactly which fields may differ so an accidental divergence fails loudly.

import { describe, expect, it } from 'vitest';
import { fluidncDriver } from './fluidnc/driver';
import { grblDriver } from './grbl/driver';
import { grblHalDriver } from './grblhal/driver';
import { selectControllerDriver } from './select-controller-driver';

describe('GRBL-family variant drivers', () => {
  it('grblHAL shares the exact GRBL wire vocabulary and capabilities', () => {
    expect(grblHalDriver.kind).toBe('grblhal');
    expect(grblHalDriver.label).toBe('grblHAL');
    expect(grblHalDriver.realtime).toEqual(grblDriver.realtime);
    expect(grblHalDriver.commands).toEqual(grblDriver.commands);
    expect(grblHalDriver.capabilities).toEqual(grblDriver.capabilities);
    expect(grblHalDriver.defaultBaudRate).toBe(115200);
  });

  it('FluidNC shares the wire vocabulary but downgrades settings writes', () => {
    expect(fluidncDriver.kind).toBe('fluidnc');
    expect(fluidncDriver.realtime).toEqual(grblDriver.realtime);
    expect(fluidncDriver.commands).toEqual(grblDriver.commands);
    expect(fluidncDriver.capabilities.settings).toBe('readonly-dump');
    expect(fluidncDriver.capabilities.firmwareSetupPanel).toBe('none');
    expect(fluidncDriver.capabilities.jog).toBe('native-jog');
    expect(fluidncDriver.capabilities.realtimePause).toBe(true);
  });

  it('selectControllerDriver resolves every ControllerKind', () => {
    expect(selectControllerDriver('grbl-v1.1')).toBe(grblDriver);
    expect(selectControllerDriver(undefined)).toBe(grblDriver);
    expect(selectControllerDriver('grblhal')).toBe(grblHalDriver);
    expect(selectControllerDriver('fluidnc')).toBe(fluidncDriver);
  });
});
