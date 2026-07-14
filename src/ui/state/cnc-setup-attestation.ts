import { fingerprintGcode, fingerprintsEqual, type GcodeFingerprint } from '../../core/recovery';

export const CNC_SETUP_ATTESTATION_PROMPT = `Before starting the CNC spindle, confirm all of the following:

• The stock and spoilboard are secured against lift and movement.
• Clamps, fixtures, screws, and hold-downs are outside the cutter, rapid, retract, and safe-Z motion envelope.
• Wrenches, setup tools, probe hardware, leads, and loose objects have been removed.
• KerfDesk is the only command owner: pendant/MPG, WebUI/Telnet/WebSocket, other sender apps, PLC motion or spindle commands, and controller macros or SD jobs are disabled or monitor-only.

Do not disable emergency-stop, safety-door, or feed-hold circuits.

KerfDesk cannot sense the physical setup or prove that another sender is inactive. This confirmation applies only to the current controller session and exact CNC program. Start?`;

export const CNC_SETUP_ATTESTATION_REQUIRED_MESSAGE =
  'CNC Start requires fresh workholding, motion-clearance, and exclusive-controller-access confirmation for the current controller session and exact program being streamed.';

export type CncControllerEpoch = {
  readonly trustedPosition: number;
  readonly workZReference: number;
};

export function cncControllerEpochOf(state: {
  readonly trustedPositionEpoch?: number;
  readonly workZReferenceEpoch: number;
}): CncControllerEpoch {
  return {
    trustedPosition: state.trustedPositionEpoch ?? 0,
    workZReference: state.workZReferenceEpoch,
  };
}

export type CncSetupAttestation = {
  readonly workholdingSecured: true;
  readonly motionEnvelopeClear: true;
  readonly setupHardwareRemoved: true;
  readonly exclusiveControllerAccess: true;
  readonly controllerEpoch: CncControllerEpoch;
  readonly programFingerprint: GcodeFingerprint;
};

export function createCncSetupAttestation(
  gcode: string,
  controllerEpoch: CncControllerEpoch,
): CncSetupAttestation {
  return {
    workholdingSecured: true,
    motionEnvelopeClear: true,
    setupHardwareRemoved: true,
    exclusiveControllerAccess: true,
    controllerEpoch,
    programFingerprint: fingerprintGcode(gcode),
  };
}

export function cncSetupAttestationMatches(
  attestation: CncSetupAttestation | null | undefined,
  gcode: string,
  controllerEpoch: CncControllerEpoch,
): boolean {
  return (
    attestation?.workholdingSecured === true &&
    attestation.motionEnvelopeClear === true &&
    attestation.setupHardwareRemoved === true &&
    attestation.exclusiveControllerAccess === true &&
    attestation.controllerEpoch !== undefined &&
    attestation.controllerEpoch.trustedPosition === controllerEpoch.trustedPosition &&
    attestation.controllerEpoch.workZReference === controllerEpoch.workZReference &&
    fingerprintsEqual(attestation.programFingerprint, fingerprintGcode(gcode))
  );
}
