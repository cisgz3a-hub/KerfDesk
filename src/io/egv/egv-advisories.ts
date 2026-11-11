// What an .egv export tells the operator about power (ADR-703). Each is a
// warning, never a refusal (rule 7 / ADR-228): the file is written either way.

import type { LhyBoardSetting, LhyEncodeResult } from '../../core/controllers/lihuiyu/lhy-encoder';
import type { Job } from '../../core/job';
import type { PreflightIssue } from '../../core/preflight';

type Encoded = Extract<LhyEncodeResult, { readonly ok: true }>;

export function egvAdvisories(
  encoded: Encoded,
  board: LhyBoardSetting,
  job: Job,
): ReadonlyArray<PreflightIssue> {
  const issues: PreflightIssue[] = [];
  for (const layerId of encoded.zeroPowerLayers) {
    issues.push({
      code: 'no-output-layer',
      message: `Layer ${layerId}: power is 0 %, so it is left out — a Lihuiyu board cannot run a burn with the beam at zero.`,
    });
  }
  if (!board.pwm) {
    const partial = encoded.motion.filter((part) => part.group.power < 100);
    if (partial.length > 0) {
      issues.push({
        code: 'power-out-of-range',
        message: `The ${board.board} board has no software power control: the machine's current knob sets the power, so ${layerList(partial.map((part) => part.group.layerId))} below 100 % burn at the knob's power.`,
      });
    }
  }
  if (job.groups.some((group) => group.kind === 'raster')) {
    issues.push({
      code: 'power-out-of-range',
      message:
        'Images burn each pixel on or off: the Lihuiyu encoder does not shade pixels, so use a dithered image mode for grey tones.',
    });
  }
  return issues;
}

function layerList(ids: ReadonlyArray<string>): string {
  const unique = [...new Set(ids)];
  return unique.length === 1 ? `layer ${unique[0] ?? ''} runs` : `layers ${unique.join(', ')} run`;
}
