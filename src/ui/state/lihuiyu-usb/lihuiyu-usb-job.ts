// Compiles the project into the job the Lihuiyu USB link sends (ADR-703): the
// same stream Save .egv writes (emitPreparedEgvWithJobWarnings, preview = save) and the
// footprint the Frame traces and Start checks. An Absolute job starts from the
// head's known position (machine coordinates from Home); an origin-relative
// job starts from its own zero, wherever the head stands.

import { lhyBoardSetting } from '../../../core/controllers/lihuiyu/lhy-encoder';
import type { LhyPoint } from '../../../core/controllers/lihuiyu/lhy-motion-plan';
import { egvPreparationOptions, type EmitEgvOptions } from '../../../io/egv';
import { emitPreparedEgvWithJobWarnings } from '../../laser/egv-job-warnings';
import type { LinkJobRequest } from '../link-job-request';
import { prepareOutput } from '../../../io/gcode';
import { withTextGlyphCheck } from '../../../io/gcode/prepare-output-snapshot';
import { resolveExportJobPlacement } from '../../job-placement';
import { outputTextRenderer } from '../../text/output-text-renderer';
import { LIHUIYU_HOME_FIRST } from './lihuiyu-usb-messages';
import type { LihuiyuUsbJob } from './lihuiyu-usb-types';

export const LIHUIYU_CURRENT_POSITION_UNSUPPORTED =
  'Current Position needs a live position report, which a Lihuiyu board does not give. Choose User Origin to run the job from where the head stands, or Absolute after Home.';

export type LihuiyuUsbJobResult =
  | { readonly ok: true; readonly job: LihuiyuUsbJob }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

/** The K40 USB job, built from the shared link-job request: the placement, the
 *  canvas output scope and the variable advance (ADR-703 Amendment 1, code
 *  quality audit C2 D6-P1-1 and D6-P2-1), as the Moshi and Ruida jobs are.
 *  `head` is where the head stands after Home, for an Absolute job. */
export async function prepareLihuiyuUsbJob(
  request: LinkJobRequest,
  head: LhyPoint | null,
): Promise<LihuiyuUsbJobResult> {
  const { project, placement, outputScope } = request;
  if (placement.startFrom === 'current-position')
    return { ok: false, messages: [LIHUIYU_CURRENT_POSITION_UNSUPPORTED] };
  const absolute = placement.startFrom === 'absolute';
  if (absolute && head === null) return { ok: false, messages: [LIHUIYU_HOME_FIRST] };
  // No live machine state exists for a Lihuiyu board: placement is the
  // export placement, relative to where the head stands.
  const resolved = resolveExportJobPlacement(placement, { statusReport: null });
  if (!resolved.ok) return { ok: false, messages: resolved.messages };
  const options: EmitEgvOptions = {
    ...(resolved.jobOrigin === undefined ? {} : { jobOrigin: resolved.jobOrigin }),
    ...(resolved.preflightMotionOffset === undefined
      ? {}
      : { preflightMotionOffset: resolved.preflightMotionOffset }),
    ...(absolute && head !== null ? { start: head } : {}),
    outputScope,
  };
  const prepared = prepareOutput(project, egvPreparationOptions(options));
  const result = emitPreparedEgvWithJobWarnings(
    await withTextGlyphCheck(prepared, project, outputTextRenderer),
    options,
  );
  if (!result.ok) return { ok: false, messages: result.messages };
  return {
    ok: true,
    job: {
      stream: result.stream,
      footprint: result.footprint,
      absolute,
      board: lhyBoardSetting(project.device.lihuiyuBoard),
      framingMmPerMin: project.device.framingFeedMmPerMin,
      // Each line once: the panel and the job bar key their lists by the text.
      advisories: [
        ...new Set([...result.advisories.map((issue) => issue.message), ...result.jobWarnings]),
      ],
      completed: request.completed,
    },
  };
}
