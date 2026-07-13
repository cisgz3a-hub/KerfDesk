import { describe, expect, it } from 'vitest';
import {
  cncSetupAttestationMatches,
  createCncSetupAttestation,
  type CncSetupAttestation,
} from './cnc-setup-attestation';

describe('CNC setup attestation', () => {
  const gcode = 'G21\nG90\nM3 S12000\nG1 X10 F500\nM5\n';

  it('binds all three physical setup confirmations to the exact program', () => {
    const attestation = createCncSetupAttestation(gcode);

    expect(attestation).toMatchObject({
      workholdingSecured: true,
      motionEnvelopeClear: true,
      setupHardwareRemoved: true,
    });
    expect(cncSetupAttestationMatches(attestation, gcode)).toBe(true);
  });

  it('rejects reuse after any program byte changes', () => {
    const attestation = createCncSetupAttestation(gcode);

    expect(cncSetupAttestationMatches(attestation, gcode.replace('X10', 'X11'))).toBe(false);
  });

  it('fails closed for incomplete runtime evidence', () => {
    const incomplete = {
      ...createCncSetupAttestation(gcode),
      setupHardwareRemoved: false,
    } as unknown as CncSetupAttestation;

    expect(cncSetupAttestationMatches(incomplete, gcode)).toBe(false);
    expect(cncSetupAttestationMatches(undefined, gcode)).toBe(false);
  });
});
