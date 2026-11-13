// What an .egv export tells the operator about power and speed (ADR-703,
// Amendments 1 and 2). Each is a warning, never a refusal (rule 7 / ADR-228):
// the file is written either way.

import type {
  LhyBoardSetting,
  LhyEncodeResult,
  LhyLayerDose,
} from '../../core/controllers/lihuiyu/lhy-encoder';
import type { Job } from '../../core/job';
import {
  airAssistNotes,
  burnedTabNotes,
  type BoardPowerTerms,
} from '../../core/output/unexpressed-power-notes';
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
  issues.push(...powerNotes(encoded, board, job).map(advisory));
  for (const { layerId, count } of encoded.rotarySpeedChanges) {
    issues.push(
      advisory(
        `Layer ${layerId}: on the rotary its strokes change speed ${count} times to keep the surface speed, and the head stops at each change.`,
      ),
    );
  }
  for (const dose of encoded.layerDoses) {
    const note = doseNote(dose, encoded.slowestMmPerSec, job);
    if (note !== null) issues.push(advisory(note));
  }
  if (job.groups.some((group) => group.kind === 'raster')) {
    issues.push(
      advisory(
        'Images burn each pixel on or off: the Lihuiyu encoder does not shade pixels, so use a dithered image mode for grey tones.',
      ),
    );
  }
  return issues;
}

function advisory(message: string): PreflightIssue {
  return { code: 'power-out-of-range', message };
}

/** The power the board cannot set: an M2 Nano's knob sets it for every layer
 *  and every burned tab (C2 verification E2-P2-3); neither board switches air
 *  (E2-P3-3). An M3 with PWM sets each group's power, tabs included. */
function powerNotes(encoded: Encoded, board: LhyBoardSetting, job: Job): string[] {
  const notes: string[] = [];
  if (!board.pwm) {
    const terms = knobTerms(board);
    // A tab group's power is a share of its layer's; the tab note names it.
    const partial = encoded.motion.filter(
      ({ group }) =>
        group.power < 100 && !(group.kind === 'cut' && group.tabSpanPowerPercent !== undefined),
    );
    if (partial.length > 0) {
      notes.push(
        `The ${board.board} board has no software power control: the machine's current knob sets the power, so ${layerList(partial.map((part) => part.group.layerId))} below 100 % burn at the knob's power.`,
      );
    }
    notes.push(...burnedTabNotes(job, terms));
  }
  notes.push(...airAssistNotes(job, `a ${board.board} board`));
  return notes;
}

function knobTerms(board: LhyBoardSetting): BoardPowerTerms {
  return {
    board: `the ${board.board} board`,
    noPowerControl: `the ${board.board} board has no software power control`,
    machinePower: "the power the machine's current knob sets",
    control: 'current knob',
  };
}

/** The dose a layer's burns get when it leaves 95-105 %: a speed below the
 *  board's slowest (E2-P1-2), or a rotary's speed classes (E2-P1-1). The band
 *  is the one the Moshiboard and Ruida rotary notes use. */
function doseNote(dose: LhyLayerDose, slowestMmPerSec: number, job: Job): string | null {
  if (dose.minDose >= 0.95 && dose.maxDose <= 1.05) return null;
  const slowest = `${formatMmPerMin(slowestMmPerSec * 60)} mm/min`;
  if (dose.rotary) {
    return `Layer ${dose.layerId}: on the rotary, strokes burn between ${percent(dose.minDose)} and ${percent(dose.maxDose)} of the set dose: a K40 board runs no slower than ${slowest}, within Max feed.`;
  }
  const group = job.groups.find((candidate) => candidate.layerId === dose.layerId);
  const speed = group === undefined || group.kind === 'cnc' ? undefined : group.speed;
  const set = speed === undefined ? 'its speed' : `its ${formatMmPerMin(speed)} mm/min`;
  return `Layer ${dose.layerId}: a K40 board runs no slower than ${slowest}, so ${set} runs at ${slowest} (${percent(dose.minDose)} of the set dose).`;
}

function percent(share: number): string {
  return `${Math.round(share * 100)} %`;
}

function formatMmPerMin(mmPerMin: number): string {
  return String(Math.round(mmPerMin * 10) / 10);
}

function layerList(ids: ReadonlyArray<string>): string {
  const unique = [...new Set(ids)];
  return unique.length === 1 ? `layer ${unique[0] ?? ''} runs` : `layers ${unique.join(', ')} run`;
}
