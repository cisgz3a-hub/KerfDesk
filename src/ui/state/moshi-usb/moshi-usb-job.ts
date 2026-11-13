// Compiles the project into the job the Moshi USB link sends (ADR-705): the
// same prepareOutput pipeline every output runs (preview = output), encoded
// as Moshi programs, and the footprint the Frame traces and Start checks.

import { prepareOutput } from '../../../io/gcode';
import { withTextGlyphCheck } from '../../../io/gcode/prepare-output-snapshot';
import { emitPreparedMoshiJob } from '../../../io/moshi';
import { outputTextRenderer } from '../../text/output-text-renderer';
import type { MoshiUsbJob } from './moshi-usb-types';
import { linkJobOutcome } from '../link-job-outcome';
import type { LinkJobRequest } from '../link-job-request';
import { sharedJobWarnings } from '../../laser/shared-job-warnings';
import { MM_PER_MIL } from '../../../core/controllers/moshi/moshi-units';
import {
  detectRotaryRowGridWarnings,
  type RotaryRowGrid,
} from '../../laser/job-review/rotary-row-step-warnings';

/** A Moshiboard places every coordinate on a whole mil (1/1000 inch). */
export const MOSHI_ROW_GRID: RotaryRowGrid = {
  stepsPerUnit: 1 / MM_PER_MIL,
  stepsText: 'Moshiboard position (1 mil, 0.0254 mm of machine Y)',
};

export const MOSHI_ABSOLUTE_ONLY =
  'A Moshiboard runs every job from its home corner and does not report where its head is. Set Start From to Absolute Coords.';

export type MoshiUsbJobResult =
  | { readonly ok: true; readonly job: MoshiUsbJob }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

export async function prepareMoshiUsbJob(request: LinkJobRequest): Promise<MoshiUsbJobResult> {
  const { project, placement, outputScope } = request;
  if (placement.startFrom !== 'absolute') return { ok: false, messages: [MOSHI_ABSOLUTE_ONLY] };
  // The canvas output scope, as Save and G-code Start compile with (C2 D2-P1-1).
  const prepared = await withTextGlyphCheck(
    prepareOutput(project, { outputScope }),
    project,
    outputTextRenderer,
  );
  const result = emitPreparedMoshiJob(prepared);
  if (!result.ok || !prepared.ok) return { ok: false, messages: result.ok ? [] : result.messages };
  return {
    ok: true,
    job: {
      programs: result.programs.map((program) => program.bytes),
      footprint: result.footprint,
      // The job warnings every G-code Save and Start shows (C2 D2-P2-1), and
      // on a Y-port rotary the Job Review row check on whole mils of machine
      // Y (v14 Z4-P2-1).
      ...linkJobOutcome(
        request,
        result.advisories,
        sharedJobWarnings(prepared, [
          ...detectRotaryRowGridWarnings(project, prepared.job, MOSHI_ROW_GRID),
        ]),
      ),
      framingFeedMmPerMin: project.device.framingFeedMmPerMin,
    },
  };
}
