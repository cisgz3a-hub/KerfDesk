// Compiles the project into the job the Moshi USB link sends (ADR-705): the
// same prepareOutput pipeline every output runs (preview = output), encoded
// as Moshi programs, and the footprint the Frame traces and Start checks.

import type { JobPlacementSettings } from '../../../core/job';
import type { Project } from '../../../core/scene';
import { prepareOutput } from '../../../io/gcode';
import { withTextGlyphCheck } from '../../../io/gcode/prepare-output-snapshot';
import { emitPreparedMoshiJob } from '../../../io/moshi';
import { outputTextRenderer } from '../../text/output-text-renderer';
import type { MoshiUsbJob } from './moshi-usb-types';
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

export async function prepareMoshiUsbJob(
  project: Project,
  placement: JobPlacementSettings,
): Promise<MoshiUsbJobResult> {
  if (placement.startFrom !== 'absolute') return { ok: false, messages: [MOSHI_ABSOLUTE_ONLY] };
  const prepared = await withTextGlyphCheck(
    prepareOutput(project, {}),
    project,
    outputTextRenderer,
  );
  const result = emitPreparedMoshiJob(prepared);
  if (!result.ok || !prepared.ok) return { ok: false, messages: result.ok ? [] : result.messages };
  // On a Y-port rotary, Fill and Image rows land on whole mils of machine Y;
  // the Job Review row check runs on that grid (ADR-705 Amd 2, v14 Z4-P2-1).
  const rowWarnings = detectRotaryRowGridWarnings(project, prepared.job, MOSHI_ROW_GRID);
  return {
    ok: true,
    job: {
      programs: result.programs.map((program) => program.bytes),
      footprint: result.footprint,
      advisories: [...result.advisories, ...rowWarnings],
      framingFeedMmPerMin: project.device.framingFeedMmPerMin,
    },
  };
}
