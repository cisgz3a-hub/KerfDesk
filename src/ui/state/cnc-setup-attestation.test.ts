import { describe, expect, it } from 'vitest';
import {
  CNC_SETUP_ATTESTATION_PROMPT,
  cncSetupAttestationMatches,
  cncSetupOverrideAcknowledgement,
  createCncSetupAttestation,
  type CncSetupAttestation,
} from './cnc-setup-attestation';

describe('CNC setup attestation', () => {
  const gcode = 'G21\nG90\nM3 S12000\nG1 X10 F500\nM5\n';
  const controllerEpoch = { trustedPosition: 7, workZReference: 11 };

  it('binds physical setup and exclusive controller access to the program and session', () => {
    const attestation = createCncSetupAttestation(gcode, controllerEpoch);

    expect(attestation).toMatchObject({
      workholdingSecured: true,
      motionEnvelopeClear: true,
      setupHardwareRemoved: true,
      exclusiveControllerAccess: true,
      controllerEpoch,
    });
    expect(cncSetupAttestationMatches(attestation, gcode, controllerEpoch)).toBe(true);
  });

  it('binds an acknowledged reduced override to the exact attestation', () => {
    const overrides = { feed: 80, rapid: 50, spindle: 100 };
    const attestation = createCncSetupAttestation(gcode, controllerEpoch, overrides);

    expect(cncSetupOverrideAcknowledgement(attestation)).toEqual(overrides);
  });

  it('rejects reuse after any program byte changes', () => {
    const attestation = createCncSetupAttestation(gcode, controllerEpoch);

    expect(
      cncSetupAttestationMatches(attestation, gcode.replace('X10', 'X11'), controllerEpoch),
    ).toBe(false);
  });

  it('rejects reuse after the controller connection or reset session changes', () => {
    const attestation = createCncSetupAttestation(gcode, controllerEpoch);

    expect(
      cncSetupAttestationMatches(attestation, gcode, {
        ...controllerEpoch,
        trustedPosition: controllerEpoch.trustedPosition + 1,
      }),
    ).toBe(false);
    expect(
      cncSetupAttestationMatches(attestation, gcode, {
        ...controllerEpoch,
        workZReference: controllerEpoch.workZReference + 1,
      }),
    ).toBe(false);
  });

  it('fails closed for incomplete runtime evidence', () => {
    const incomplete = {
      ...createCncSetupAttestation(gcode, controllerEpoch),
      setupHardwareRemoved: false,
    } as unknown as CncSetupAttestation;

    expect(cncSetupAttestationMatches(incomplete, gcode, controllerEpoch)).toBe(false);
    expect(cncSetupAttestationMatches(undefined, gcode, controllerEpoch)).toBe(false);
  });

  it('fails closed when exclusive controller access is not affirmed', () => {
    const sharedAccess = {
      ...createCncSetupAttestation(gcode, controllerEpoch),
      exclusiveControllerAccess: false,
    } as unknown as CncSetupAttestation;

    expect(cncSetupAttestationMatches(sharedAccess, gcode, controllerEpoch)).toBe(false);
  });

  it('fails closed for legacy evidence without an epoch binding', () => {
    const legacy = {
      ...createCncSetupAttestation(gcode, controllerEpoch),
      controllerEpoch: undefined,
    } as unknown as CncSetupAttestation;

    expect(cncSetupAttestationMatches(legacy, gcode, controllerEpoch)).toBe(false);
  });

  it('names competing command paths without asking operators to disable safety circuits', () => {
    expect(CNC_SETUP_ATTESTATION_PROMPT).toMatch(/pendant\/MPG/i);
    expect(CNC_SETUP_ATTESTATION_PROMPT).toMatch(/WebUI\/Telnet\/WebSocket/i);
    expect(CNC_SETUP_ATTESTATION_PROMPT).toMatch(/PLC motion or spindle commands/i);
    expect(CNC_SETUP_ATTESTATION_PROMPT).toMatch(/Do not disable emergency-stop/i);
  });
});
