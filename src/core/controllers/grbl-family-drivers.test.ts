// The grblHAL and FluidNC drivers are deltas on the GRBL driver: identical
// wire vocabulary, distinct identity + capability overrides. These tests pin
// exactly which fields may differ so an accidental divergence fails loudly.

import { describe, expect, it } from 'vitest';
import { fluidncDriver } from './fluidnc/driver';
import { grblDriver } from './grbl/driver';
import { grblHalDriver } from './grblhal/driver';
import { marlinDriver } from './marlin/driver';
import { ruidaDriver } from './ruida/driver';
import { selectControllerDriver } from './select-controller-driver';
import { smoothiewareDriver } from './smoothieware/driver';

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

  it('exposes G38.2 probing only on GRBL-grammar firmwares', () => {
    // The probe runner parses GRBL responses (ok pacing, ALARM:4/5,
    // <status>); a different grammar could report false success and zero Z
    // at the wrong height, so non-GRBL drivers must declare probing: false.
    expect(grblDriver.capabilities.probing).toBe(true);
    expect(grblHalDriver.capabilities.probing).toBe(true);
    expect(fluidncDriver.capabilities.probing).toBe(true);
    expect(marlinDriver.capabilities.probing).toBe(false);
    expect(smoothiewareDriver.capabilities.probing).toBe(false);
    expect(ruidaDriver.capabilities.probing).toBe(false);
  });

  it('allows CNC spindle jobs only on GRBL-dialect firmwares (ADR-098)', () => {
    // The CNC emitter's G4 P dwell is SECONDS; Marlin reads milliseconds, so
    // streaming CNC to a non-GRBL dialect loses the spindle spin-up time.
    expect(grblDriver.capabilities.cncJobs).toBe(true);
    expect(grblHalDriver.capabilities.cncJobs).toBe(true);
    expect(fluidncDriver.capabilities.cncJobs).toBe(true);
    expect(marlinDriver.capabilities.cncJobs).toBe(false);
    expect(smoothiewareDriver.capabilities.cncJobs).toBe(false);
    expect(ruidaDriver.capabilities.cncJobs).toBe(false);
  });
});
