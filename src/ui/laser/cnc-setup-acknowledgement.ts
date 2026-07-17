// confirmCncSetup — the CNC workholding / motion-clearance / exclusive-access
// attestation, extracted from start-job-flow so the Job Review dialog
// (ADR-224) can render the exact prompt text while the review gate builds
// the same attestation object without a native confirm(). Parameterized by
// `confirm` exactly like its laser twin (laser-mode-start-acknowledgement).

import type { OverrideValues } from '../../core/controllers/grbl';
import type { MachineKind } from '../../core/scene';
import { reducedOverrideAcknowledgement } from '../state/cnc-accessory-readiness';
import {
  CNC_SETUP_ATTESTATION_PROMPT,
  cncControllerEpochOf,
  createCncSetupAttestation,
  type CncSetupAttestation,
} from '../state/cnc-setup-attestation';
import { useLaserStore } from '../state/laser-store';

/** The exact operator-facing attestation text, including the reduced-override
 * sentence when the cached controller overrides are a known safe reduction. */
export function cncSetupAttestationPrompt(overrides: OverrideValues | null): string {
  const overrideAcknowledgement = reducedOverrideAcknowledgement(overrides);
  return overrideAcknowledgement === undefined
    ? CNC_SETUP_ATTESTATION_PROMPT
    : `${CNC_SETUP_ATTESTATION_PROMPT}\n\nConfirm these exact reduced controller overrides: feed ${overrideAcknowledgement.feed}%, rapid ${overrideAcknowledgement.rapid}%, spindle ${overrideAcknowledgement.spindle}%.`;
}

/** undefined = not a CNC start (no attestation applies); null = declined. */
export function confirmCncSetup(
  machineKind: MachineKind,
  gcode: string,
  overrides: OverrideValues | null,
  confirm: (message: string) => boolean,
): CncSetupAttestation | null | undefined {
  if (machineKind !== 'cnc') return undefined;
  if (!confirm(cncSetupAttestationPrompt(overrides))) return null;
  return createCncSetupAttestation(
    gcode,
    cncControllerEpochOf(useLaserStore.getState()),
    reducedOverrideAcknowledgement(overrides),
  );
}
