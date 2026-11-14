// emitMoshiJob — the Moshiboard twin of emitRdFile (ADR-705): it runs the SAME
// prepareOutput pipeline (preview = output, ADR-040), encodes the programs the
// USB link sends, then runs the post-compile checks a G-code save runs over
// the moves those programs command. A Moshiboard has no job file, so nothing
// here writes one. Placement is absolute: a Moshi program has no relative
// origin, and the board does not report where its head is.

import {
  describeMoshiEncodeError,
  encodeMoshiJob,
  type MoshiFootprint,
  type MoshiJobProgram,
} from '../../core/controllers/moshi';
import { machineSpaceJob } from '../../core/job';
import { rotaryOutputAxis } from '../../core/job/rotary-job';
import type { Project } from '../../core/scene';
import { rotaryAxisUnsupportedMessage } from '../gcode/rotary-axis-emit';
import type { PreparedOutput } from '../gcode';
import { runMoshiPreflight } from './moshi-preflight';

export type MoshiJobResult =
  | {
      readonly ok: true;
      readonly programs: ReadonlyArray<MoshiJobProgram>;
      /** Where the job runs, in mils from the home corner: the Frame traces it. */
      readonly footprint: MoshiFootprint;
      /** Findings that inform but never refuse (rule 7 / ADR-228). */
      readonly advisories: ReadonlyArray<string>;
    }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

export const MOSHI_ORIGIN_MESSAGE =
  'A Moshiboard homes to the rear-left corner and its moves run from there. Set the machine origin to Rear left in Machine Setup. Nothing was sent.';
const ORIGIN_MESSAGE = MOSHI_ORIGIN_MESSAGE;

/** Encodes an output prepared with absolute placement (no jobOrigin). */
export function emitPreparedMoshiJob(prepared: PreparedOutput): MoshiJobResult {
  if (!prepared.ok) {
    return { ok: false, messages: prepared.preflight.issues.map((issue) => issue.message) };
  }
  const project: Project = prepared.project;
  // The board's frame is fixed: home at the rear-left, Y toward the operator
  // (moshi-profile.ts). The job is already in machine coordinates for the
  // profile's origin, so any other origin would burn mirrored, as the K40
  // route refuses too (audit of the last 200 PRs, #1723).
  if (project.device.origin !== 'rear-left') return { ok: false, messages: [ORIGIN_MESSAGE] };
  // A Moshi rotary turns on its own Y; a dedicated A or Z axis has no
  // Moshi command, so it gets no job rather than one that moves the gantry.
  const rotaryAxis = rotaryOutputAxis(project.device, project.machine);
  if (rotaryAxis !== null)
    return { ok: false, messages: [rotaryAxisUnsupportedMessage(project, rotaryAxis) ?? ''] };
  const machineJob = machineSpaceJob(prepared.job, project.device, project.machine);
  const encoded = encodeMoshiJob(machineJob, project.device);
  if (!encoded.ok) return { ok: false, messages: [describeMoshiEncodeError(encoded.error)] };
  const checks = runMoshiPreflight(project, encoded.motion);
  const advisories = [
    ...(prepared.advisories ?? []).map((issue) => issue.message),
    ...encoded.notes,
    ...checks.map((issue) => issue.message),
  ];
  return {
    ok: true,
    programs: encoded.programs,
    footprint: encoded.footprint,
    advisories: [...new Set(advisories)],
  };
}
