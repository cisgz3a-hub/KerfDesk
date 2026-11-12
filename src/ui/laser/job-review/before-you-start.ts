// "Before you start" — the plain safety points every laser and CNC Job
// Review shows above Start job, on the PC and on the phone remote (ADR-689).
// Wording, not a guard (ADR-228): folding it changes nothing the review
// hands off. The points follow Help → Safety & liability (safety-notice.ts).

import type { MachineKind } from '../../../core/scene';
import type { JobReviewAcknowledgement } from './job-review-model';
import { browserLocalStorage } from '../../state/browser-local-storage';
import { saveComputerPreference } from '../../state/preference-persistence';

export const BEFORE_YOU_START_HEADING = 'Before you start';

export const LASER_BEFORE_YOU_START: readonly string[] = [
  "Wear laser safety glasses rated for your laser's wavelength.",
  "Focus the laser on the top of your material. The gap changes with the material's thickness.",
  'Stay with the laser while it runs and keep a fire extinguisher close. A camera or phone is not supervision.',
  'Use air assist and ventilation.',
];

export const CNC_BEFORE_YOU_START: readonly string[] = [
  'Wear eye and ear protection.',
  'Clamp the material down and keep the clamps clear of the toolpath.',
  'Stay with the machine while it runs, hands clear of the bit. A camera or phone is not supervision.',
];

export function beforeYouStartLines(machineKind: MachineKind): readonly string[] {
  return machineKind === 'cnc' ? CNC_BEFORE_YOU_START : LASER_BEFORE_YOU_START;
}

/** One paragraph for surfaces that show plain text, such as the phone remote. */
export function beforeYouStartText(machineKind: MachineKind): string {
  return `${BEFORE_YOU_START_HEADING}: ${beforeYouStartLines(machineKind).join(' ')}`;
}

export type RemoteReviewAcknowledgementKind = 'laser-verified' | 'laser-unverified' | 'cnc';

/** The remote review's acknowledgement: the safety points first, then any
 * prompt the operator confirms, whose question stays last. Every deployed
 * phone and MCP client already shows `prompt`, so no Worker change is needed.
 * An operator-stated power scale (ADR-095 Amendment 1) goes out as
 * `laser-unverified` with its fact line: the deployed clients know three
 * kinds, and KerfDesk has not verified it. */
export function remoteReviewAcknowledgement(
  acknowledgement: JobReviewAcknowledgement,
  machineKind: MachineKind,
): { readonly kind: RemoteReviewAcknowledgementKind; readonly prompt: string } {
  const safety = beforeYouStartText(machineKind);
  switch (acknowledgement.kind) {
    case 'laser-verified':
      return { kind: 'laser-verified', prompt: safety };
    case 'laser-operator-stated':
      return { kind: 'laser-unverified', prompt: `${safety}\n\n${acknowledgement.statement}` };
    case 'laser-unverified':
    case 'cnc':
      return { kind: acknowledgement.kind, prompt: `${safety}\n\n${acknowledgement.prompt}` };
  }
}

// Folding is remembered per machine (profile id, else name) on this computer. A machine never
// folded starts open, so a new machine always shows the points once.
const FOLDED_KEY_PREFIX = 'laserforge.job-review.before-you-start-folded.v1:';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function beforeYouStartFoldedKey(deviceId: string): string {
  return `${FOLDED_KEY_PREFIX}${deviceId}`;
}

export function readBeforeYouStartFolded(
  deviceId: string,
  storage: PreferenceStorage | null = browserLocalStorage(),
): boolean {
  try {
    return storage?.getItem(beforeYouStartFoldedKey(deviceId)) === '1';
  } catch {
    return false;
  }
}

export function writeBeforeYouStartFolded(
  deviceId: string,
  folded: boolean,
  storage?: PreferenceStorage | null,
): void {
  saveComputerPreference(beforeYouStartFoldedKey(deviceId), folded ? '1' : '0', { storage });
}
