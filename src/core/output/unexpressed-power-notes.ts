// What a board without power or air control cannot express, named for this
// job (ADR-705 Amendment 4, C2 D2-P2-2 and D2-P3-3; ADR-703 Amendment 2, C2
// verification E2-P2-3 and E2-P3-3). A Moshiboard and a K40 M2 Nano fire the
// beam at the power the machine's own control sets wherever a layer is above
// 0 %, and neither switches air. These notes name the layers that changes:
// burned tabs that cut through, lighter layers that burn like the strongest,
// and air the board cannot switch. Notes only: the bytes do not change and
// nothing is refused.

import type { Group, Job } from '../job';
import { roundToTenth } from '../util/rounding';

type LaserGroup = Exclude<Group, { readonly kind: 'cnc' }>;

/** How a board's notes name it and the machine's own power control. */
export type BoardPowerTerms = {
  /** "a Moshiboard", "the M2 board". */
  readonly board: string;
  /** "a Moshiboard has no power control". */
  readonly noPowerControl: string;
  /** "the machine's dial power". */
  readonly machinePower: string;
  /** "dial", "current knob". */
  readonly control: string;
};

function laserGroups(job: Job): ReadonlyArray<LaserGroup> {
  return job.groups.filter((group): group is LaserGroup => group.kind !== 'cnc');
}

/** Burned tabs burn at the machine's power and cut through. */
export function burnedTabNotes(job: Job, terms: BoardPowerTerms): string[] {
  const notes: string[] = [];
  for (const group of laserGroups(job)) {
    if (group.kind !== 'cut' || group.tabSpanPowerPercent === undefined || !(group.power > 0))
      continue;
    notes.push(
      `Layer ${group.layerId}: its burned tabs are set to ${roundToTenth(group.tabSpanPowerPercent)} % of the cut, but ${terms.noPowerControl}, so they burn at ${terms.machinePower} and cut through. Set the tab power to 0 % to leave the tabs uncut.`,
    );
  }
  return notes;
}

/** Layers set to different powers all burn at the machine's power. */
export function mixedPowerNotes(job: Job, terms: BoardPowerTerms): string[] {
  const powers = new Set<number>();
  for (const group of laserGroups(job)) {
    if (group.kind === 'cut' && group.tabSpanPowerPercent !== undefined) continue;
    if (group.power > 0) powers.add(roundToTenth(group.power));
  }
  if (powers.size < 2) return [];
  const listed = [...powers].sort((a, b) => a - b).map((power) => `${power} %`);
  return [
    `This job sets layers to ${listed.join(', ')} power, but ${terms.board} burns every layer above 0 % at ${terms.machinePower}, so the lighter layers burn like the strongest. Run them as separate jobs with the ${terms.control} set for each.`,
  ];
}

/** Air assist the board cannot switch. */
export function airAssistNotes(job: Job, board: string): string[] {
  const groups = laserGroups(job).filter((group) => group.airAssist);
  const layers = [...new Set(groups.map((group) => group.layerId))];
  if (layers.length === 0) return [];
  return [
    `Air assist is on for layer ${layers.join(', ')}, but ${board} has no air output KerfDesk can switch. Run the air from the machine.`,
  ];
}
