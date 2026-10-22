// resume-review-warnings — what a laser resume's confirmation lists (audit v3
// D5-P2-4, ADR-232 Amendment 1). Recovery and Start from line qualify the
// original program, so its warnings, no-go crossings included, come from a
// scan that starts at the head and runs every line. The resume sends a
// preamble whose beam-off rapid goes from where the head stands now straight
// to the restart point, a move the original never makes. That program, the one
// actually sent, is scanned from the live head with Start's trusted bed
// offset, and its preamble's crossings join the original's warnings. The
// replayed tail is the original from the restart line, already scanned.

import type { ResumeProgram } from '../../core/controllers/grbl/resume-program';
import { machineBoundsForDevice, type DeviceProfile } from '../../core/devices';
import { nativePointToBed } from '../../core/devices/native-bed-frame';
import { findNoGoZoneCollisions } from '../../core/preflight/no-go-zones';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { inferCurrentMachinePosition } from '../state/infer-machine-position';
import { resolveNativeBedFrame, selectNativeBedEvidence } from '../state/native-bed-frame';
import type { PreparedRecoverySource } from './start-job-source';

/** The qualification a resume's confirmation needs from its prepared source. */
export type ResumeQualification = Pick<
  PreparedRecoverySource,
  'warnings' | 'preflightMotionOffset'
>;

type ResumeSource = ResumeQualification &
  Pick<PreparedRecoverySource, 'project' | 'controllerSnapshot'>;

/** The original program's warnings plus the no-go zones the resume's own
 * re-entry move crosses. */
export function resumeReviewWarnings(
  source: ResumeSource,
  resume: Pick<ResumeProgram, 'lines' | 'preambleCount'>,
): ReadonlyArray<string> {
  return [...new Set([...source.warnings, ...reentryNoGoWarnings(source, resume)])];
}

/** One acknowledgement for a resume's warnings; true when there are none. */
export function confirmResumeWarnings(warnings: ReadonlyArray<string>): boolean {
  if (warnings.length === 0) return true;
  return jobAwareConfirm(
    `Controller warning:\n\n${warnings.map((warning) => `• ${warning}`).join('\n')}\n\nContinue recovery?`,
  );
}

function reentryNoGoWarnings(
  source: ResumeSource,
  resume: Pick<ResumeProgram, 'lines' | 'preambleCount'>,
): ReadonlyArray<string> {
  const device = source.project.device;
  const zones = device.noGoZones.filter((zone) => zone.enabled);
  // Without a trusted bed offset the original's warnings already say zones
  // cannot be checked, as Start's do.
  const motionOffset = source.preflightMotionOffset;
  if (zones.length === 0 || motionOffset === undefined) return [];
  const head = liveHeadOnBed(source.controllerSnapshot, device);
  const collisions = findNoGoZoneCollisions(resume.lines, zones, machineBoundsForDevice(device), {
    motionOffset,
    ...(head === null ? {} : { initialMachinePosition: head }),
  });
  return collisions
    .filter((collision) => collision.lineNumber <= resume.preambleCount)
    .map(
      (collision) =>
        `The resume's re-entry move (${(resume.lines[collision.lineNumber - 1] ?? '').trim()}) ` +
        `from where the head is now to the restart point crosses the configured no-go zone ` +
        `"${collision.zone.name}". It runs with the beam off; watch the move and stop it, or use ` +
        'the physical E-stop, if needed.',
    );
}

// Where Start puts the head for its entry move (initialMachinePositionOption):
// only through a verified native-to-bed frame.
function liveHeadOnBed(
  laser: PreparedRecoverySource['controllerSnapshot'],
  device: DeviceProfile,
): { readonly x: number; readonly y: number } | null {
  const native = inferCurrentMachinePosition(
    laser.statusReport,
    laser.wcoCache ?? laser.statusReport?.wco ?? null,
    laser.controllerSettings?.reportInches === true,
  );
  const frame = resolveNativeBedFrame(device, selectNativeBedEvidence(laser));
  return native === null || frame === null ? null : nativePointToBed(native, frame);
}
