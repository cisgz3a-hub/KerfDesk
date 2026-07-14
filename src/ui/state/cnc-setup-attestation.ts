import { fingerprintGcode, fingerprintsEqual, type GcodeFingerprint } from '../../core/recovery';

export const CNC_SETUP_ATTESTATION_PROMPT = `Before starting the CNC spindle, confirm all of the following:

• The stock and spoilboard are secured against lift and movement.
• Clamps, fixtures, screws, and hold-downs are outside the cutter, rapid, retract, and safe-Z motion envelope.
• Wrenches, setup tools, probe hardware, leads, and loose objects have been removed.

KerfDesk checks modeled no-go zones but cannot sense the physical setup. Start this exact CNC program?`;

export const CNC_SETUP_ATTESTATION_REQUIRED_MESSAGE =
  'CNC Start requires a fresh workholding and motion-clearance confirmation for the exact program being streamed.';

export type CncSetupAttestation = {
  readonly workholdingSecured: true;
  readonly motionEnvelopeClear: true;
  readonly setupHardwareRemoved: true;
  readonly programFingerprint: GcodeFingerprint;
};

export function createCncSetupAttestation(gcode: string): CncSetupAttestation {
  return {
    workholdingSecured: true,
    motionEnvelopeClear: true,
    setupHardwareRemoved: true,
    programFingerprint: fingerprintGcode(gcode),
  };
}

export function cncSetupAttestationMatches(
  attestation: CncSetupAttestation | null | undefined,
  gcode: string,
): boolean {
  return (
    attestation?.workholdingSecured === true &&
    attestation.motionEnvelopeClear === true &&
    attestation.setupHardwareRemoved === true &&
    fingerprintsEqual(attestation.programFingerprint, fingerprintGcode(gcode))
  );
}
