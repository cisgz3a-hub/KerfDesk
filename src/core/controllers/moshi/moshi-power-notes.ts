// What a Moshiboard cannot express, named for this job (ADR-705 Amendment 4,
// code quality audit C2 D2-P2-2 and D2-P3-3). A Moshi program has no power
// value (meerk40t/moshi/driver.py `laser_on`/`laser_off` L200-220: "Moshiboards
// do not support this command") and no air output, so the beam fires at the
// machine's dial power wherever a layer is above 0 %. The panel's general
// note says so; these name the layers it changes (the shared notes in
// output/unexpressed-power-notes.ts, which the K40 uses too). Grey image
// pixels are named by the encoder, which reads them.

import type { Job } from '../../job';
import {
  airAssistNotes,
  burnedTabNotes,
  mixedPowerNotes,
  type BoardPowerTerms,
} from '../../output/unexpressed-power-notes';

const MOSHI_TERMS: BoardPowerTerms = {
  board: 'a Moshiboard',
  noPowerControl: 'a Moshiboard has no power control',
  machinePower: "the machine's dial power",
  control: 'dial',
};

export function moshiPowerNotes(job: Job): string[] {
  return [
    ...burnedTabNotes(job, MOSHI_TERMS),
    ...mixedPowerNotes(job, MOSHI_TERMS),
    ...airAssistNotes(job, MOSHI_TERMS.board),
  ];
}
