// HomedBedCorrectionOffer — at connect, names a grblHAL bed widened to the
// controller's whole travel and offers its homed area instead (rolling audit
// v9 R6-P2-3, ADR-637 Amendment 5). 1.0.28 offered `$130` × `$131` as the
// bed, so a Falcon A1 Pro profile that took it frames and runs 5 mm past
// what the head can reach after its homing pull-off.
//
// Nothing is changed for the operator: a smaller bed moves artwork already
// placed on a front origin, so the offer says by how much and waits. Once
// answered, it is not asked again in this run for that profile and pair of
// sizes; until it is taken, Frame and Start warn by name.

import { useState } from 'react';
import { useStore } from '../state';
import { applyDetectedSettingsPatch } from '../state/detected-settings-action';
import {
  bedCorrectionShift,
  bedWiderThanHomedArea,
  formatBed,
  type WidenedBed,
} from '../state/homed-area-bed';
import { useLaserStore } from '../state/laser-store';
import { selectNativeBedEvidence } from '../state/native-bed-frame';
import { deviceProfileSignature } from './device-setup/device-setup-nudge';

const answered = new Set<string>();

/** Test seam: forget which offers this run already answered. */
export function resetAnsweredBedCorrections(): void {
  answered.clear();
}

export function HomedBedCorrectionOffer(): JSX.Element | null {
  const device = useStore((s) => s.project.device);
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const connected = useLaserStore((s) => s.connection.kind === 'connected');
  const evidence = useLaserStore(selectNativeBedEvidence);
  const [, rerender] = useState(0);
  const widened = connected ? bedWiderThanHomedArea(device, evidence) : null;
  if (widened === null) return null;
  const key = offerKey(deviceProfileSignature(device, machineKind), widened);
  if (answered.has(key)) return null;
  const answer = (take: boolean) => {
    answered.add(key);
    if (take)
      applyDetectedSettingsPatch({
        bedWidth: widened.homedArea.widthMm,
        bedHeight: widened.homedArea.heightMm,
      });
    rerender((count) => count + 1);
  };
  const corrected = formatBed(widened.homedArea);
  return (
    <div role="region" aria-label="Bed correction" style={offerStyle}>
      <span>{describeBedCorrection(device.origin, widened)}</span>
      <button
        type="button"
        onClick={() => answer(true)}
        title={`Set this profile's bed to ${corrected}. No controller setting is written.`}
      >
        Correct bed to {corrected}
      </button>
      <button
        type="button"
        onClick={() => answer(false)}
        title="Keep the bed. Frame and Start warn while a route leaves the homed area."
      >
        Not now
      </button>
    </div>
  );
}

export function describeBedCorrection(
  origin: Parameters<typeof bedCorrectionShift>[0],
  widened: WidenedBed,
): string {
  return (
    `This profile's bed is ${formatBed(widened.bed)}, the controller's whole travel. ` +
    `After the homing pull-off its homed area is ${formatBed(widened.homedArea)}, and nothing ` +
    `stops a Frame or a job past it. Correct the bed from ${formatBed(widened.bed)} to ` +
    `${formatBed(widened.homedArea)}? ${bedCorrectionShift(origin, widened)}`
  );
}

function offerKey(profile: string, widened: WidenedBed): string {
  return JSON.stringify([profile, widened.bed, widened.homedArea]);
}

const offerStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--lf-space-2)',
  fontSize: 'var(--lf-text-sm)',
};
