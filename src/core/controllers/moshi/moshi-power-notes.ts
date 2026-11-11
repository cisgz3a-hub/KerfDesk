// What a Moshiboard cannot express, named for this job (ADR-705 Amendment 4,
// code quality audit C2 D2-P2-2 and D2-P3-3). A Moshi program has no power
// value (meerk40t/moshi/driver.py `laser_on`/`laser_off` L200-220: "Moshiboards
// do not support this command") and no air output, so the beam fires at the
// machine's dial power wherever a layer is above 0 %. The panel's general
// note says so; these name the layers it changes: burned tabs that cut
// through, lighter layers that burn like the strongest, and air the board
// cannot switch. Grey image pixels are named by the encoder, which reads
// them. Notes only: the bytes do not change and nothing is refused.

import type { Group, Job } from '../../job';

type LaserGroup = Exclude<Group, { readonly kind: 'cnc' }>;

export function moshiPowerNotes(job: Job): string[] {
  const groups = job.groups.filter((group): group is LaserGroup => group.kind !== 'cnc');
  return [...tabNotes(groups), ...mixedPowerNotes(groups), ...airNotes(groups)];
}

function tabNotes(groups: ReadonlyArray<LaserGroup>): string[] {
  const notes: string[] = [];
  for (const group of groups) {
    if (group.kind !== 'cut' || group.tabSpanPowerPercent === undefined || !(group.power > 0))
      continue;
    notes.push(
      `Layer ${group.layerId}: its burned tabs are set to ${round(group.tabSpanPowerPercent)} % of the cut, but a Moshiboard has no power control, so they burn at the machine's dial power and cut through. Set the tab power to 0 % to leave the tabs uncut.`,
    );
  }
  return notes;
}

function mixedPowerNotes(groups: ReadonlyArray<LaserGroup>): string[] {
  const powers = new Set<number>();
  for (const group of groups) {
    if (group.kind === 'cut' && group.tabSpanPowerPercent !== undefined) continue;
    if (group.power > 0) powers.add(round(group.power));
  }
  if (powers.size < 2) return [];
  const listed = [...powers].sort((a, b) => a - b).map((power) => `${power} %`);
  return [
    `This job sets layers to ${listed.join(', ')} power, but a Moshiboard burns every layer above 0 % at the machine's dial power, so the lighter layers burn like the strongest. Run them as separate jobs with the dial set for each.`,
  ];
}

function airNotes(groups: ReadonlyArray<LaserGroup>): string[] {
  const layers = [...new Set(groups.filter((group) => group.airAssist).map((g) => g.layerId))];
  if (layers.length === 0) return [];
  return [
    `Air assist is on for layer ${layers.join(', ')}, but a Moshiboard has no air output KerfDesk can switch. Run the air from the machine.`,
  ];
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
