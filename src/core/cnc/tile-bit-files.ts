// One tile file per bit (ADR-392 Amendment 2; controller audit v4 E3-P2-1).
// A tile file runs only through Run G-code file, which sends an M0 to the
// controller as written. Stock GRBL then reads no further line until cycle
// start (protocol.c loops `while (sys.suspend)`), so no jog or Zero Z can
// reach it, and the next bit's spindle start and plunge are already in its
// buffer. Cutting a tile at every bit change leaves each piece single-bit, so
// the emitter writes no M0 at all: the operator changes the bit and re-zeroes
// Z between files, with the machine Idle and every jog and probe tool usable.

import { sanitizeGcodeCommentValue } from '../gcode-comments';
import type { Group, Job } from '../job';
import type { CncTile } from './cnc-tile';
import { tileFileName } from './tile-plan';

/** Matches the emitter's bit-name budget in its tool-change comment. */
const TOOL_NAME_MAX_BYTES = 40;
const UNNAMED_TOOL = 'unnamed tool';

/** One run of a tile's work on a single bit, in the tile's own order. */
export type TileBitRun = {
  readonly job: Job;
  readonly toolName: string;
};

/** Where a bit run sits among the files its tile writes. */
export type TileBitStep = {
  readonly toolName: string;
  /** One-based position of this bit in the tile's run order. */
  readonly step: number;
  readonly steps: number;
};

/**
 * Split a tile's tool-ordered job wherever the bit changes. The key is the
 * one the emitter's tool-change test uses (`toolId`, or none), so every piece
 * emits as a single-tool program. A bit that comes back later in the order is
 * its own later piece, which keeps the release order the tile already has.
 */
export function splitTileJobByBit(job: Job): ReadonlyArray<TileBitRun> {
  const runs: Group[][] = [];
  let currentKey: string | null = null;
  for (const group of job.groups) {
    const key = bitKey(group);
    if (key !== currentKey || runs.length === 0) {
      runs.push([]);
      currentKey = key;
    }
    runs[runs.length - 1]?.push(group);
  }
  return runs.map((groups) => ({ job: { ...job, groups }, toolName: bitName(groups[0]) }));
}

/** Number the runs a tile writes, in order. */
export function numberTileBitFiles<Run extends TileBitRun>(
  runs: ReadonlyArray<Run>,
): ReadonlyArray<Run & TileBitStep> {
  return runs.map((run, index) => ({ ...run, step: index + 1, steps: runs.length }));
}

/** Whether a tile set needs more than one bit across all its tiles. */
export function tileSetUsesSeveralBits(jobs: ReadonlyArray<Job>): boolean {
  const keys = new Set<string>();
  for (const job of jobs) for (const group of job.groups) keys.add(bitKey(group));
  return keys.size > 1;
}

/** `job_tile-r1-c2` for a one-bit tile, `job_tile-r1-c2_bit-1-of-2` otherwise. */
export function tileBitFileName(baseName: string, tile: CncTile, file: TileBitStep): string {
  const name = tileFileName(baseName, tile);
  return file.steps > 1 ? `${name}_bit-${file.step}-of-${file.steps}` : name;
}

/** The one-file tile name a per-bit file name came from, or null for a
 * one-bit tile: an earlier save may have written that tile as one file. */
export function tileNameWithoutBit(fileName: string): string | null {
  const match = /^(.*)_bit-\d+-of-\d+$/.exec(fileName);
  return match?.[1] ?? null;
}

/** Header comments that name the bit and what to zero before this file runs. */
export function tileBitHeader(file: TileBitStep): string {
  const bit =
    file.steps > 1
      ? `; bit ${file.step} of ${file.steps} for this tile: ${file.toolName}`
      : `; bit: ${file.toolName}`;
  const zero =
    file.step === 1
      ? '; load this bit and zero Z on the stock top before running this file'
      : "; keep this tile's X/Y zero; change to this bit and re-zero Z on the stock top before running this file";
  return `${bit}\n${zero}\n`;
}

function bitKey(group: Group): string {
  return group.kind === 'cnc' ? (group.toolId ?? '') : '';
}

function bitName(group: Group | undefined): string {
  const name = group?.kind === 'cnc' ? group.toolName : undefined;
  if (name === undefined) return UNNAMED_TOOL;
  return sanitizeGcodeCommentValue(name, TOOL_NAME_MAX_BYTES) || UNNAMED_TOOL;
}
