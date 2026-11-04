// Facts about one prepared program that Job Review reads each time it builds
// its model, which it does when it opens and again at Confirm. Each walked the
// whole program: at 374,843 lines (5 MB) about 140 ms of the UI thread between
// Start and the review (performance audit S1-P2-2, ADR-598 Amendment 4).
//
// Every fact is the value of the very function the review called, measured
// once per preparation: in the worker that emitted the program, which sends
// them beside it (start-preparation-wire.ts), or here on first use. They are
// keyed by the preparation object, so a preparation with other bytes, even
// one spread from this one, never reads them.

import {
  longestSendableLineSpan,
  measureSendableLines,
} from '../../../core/controllers/grbl/sendable-line-scan';
import { gcodeUsesM7 } from '../../../core/preflight/m7-air-assist-readiness';
import { stringBytes } from '../../state/recovery/execution-artifact-size';
import { formatTrimmedLineCount } from './job-review-format';

export type ProgramFacts = {
  /** gcodeUsesM7 */
  readonly usesM7: boolean;
  /** measureSendableLines */
  readonly sendable: { readonly lines: number; readonly bytes: number };
  /** longestSendableLineSpan: no line over the RX window needs a scan below it. */
  readonly longestSendableSpan: number;
  /** formatTrimmedLineCount */
  readonly trimmedLineCount: number;
  /** stringBytes, the recovery archive's lower bound for the program text. */
  readonly archiveBytes: number;
};

type ProgramHolder = { readonly gcode: string };

const factsByPreparation = new WeakMap<ProgramHolder, ProgramFacts>();

export function measureProgramFacts(gcode: string): ProgramFacts {
  return {
    usesM7: gcodeUsesM7(gcode),
    sendable: measureSendableLines(gcode),
    longestSendableSpan: longestSendableLineSpan(gcode),
    trimmedLineCount: formatTrimmedLineCount(gcode),
    archiveBytes: stringBytes(gcode),
  };
}

export function programFactsOf(prepared: ProgramHolder): ProgramFacts {
  const known = factsByPreparation.get(prepared);
  if (known !== undefined) return known;
  const measured = measureProgramFacts(prepared.gcode);
  factsByPreparation.set(prepared, measured);
  return measured;
}

/** Record facts measured from this preparation's own program elsewhere. */
export function seedProgramFacts(prepared: ProgramHolder, facts: ProgramFacts): void {
  factsByPreparation.set(prepared, facts);
}

/** `to` holds the same program as `from` (a copy that replaced other fields). */
export function carryProgramFacts(from: ProgramHolder, to: ProgramHolder): void {
  const known = factsByPreparation.get(from);
  if (known !== undefined && from.gcode === to.gcode) factsByPreparation.set(to, known);
}
