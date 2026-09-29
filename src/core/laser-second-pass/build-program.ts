import { buildBrushIndex, validateSelection, type BrushIndex } from './brush-index';
import { partitionBrushPower } from './brush-partition';
import {
  createProgramWriter,
  finishProgram,
  selectedPower,
  writeClippedSegment,
  writeSourceSegment,
  writeSourceRapid,
} from './program-writer';
import { errorMessage, visitLaserSecondPassSource } from './source';
import { clampedParameter, measureSweepWindows, segmentLengthMm } from './sweep-window';
import type {
  LaserSecondPassProgramResult,
  LaserSecondPassSelection,
  LaserSecondPassWriterVersion,
} from './types';

/** The writer new painted passes use; saved stages record their own. */
export const LASER_SECOND_PASS_WRITER_VERSION: LaserSecondPassWriterVersion = 3;

/**
 * Derive a new pass from the exact archived bytes. Source sweeps retain their
 * original runways, direction, feed, and tonal modulation. Only painted motion
 * receives power; entirely unpainted motion contexts are omitted.
 * Saved writer 2 trims each sweep to the painted span plus its own runways.
 * Writer 3 retains the whole connected motion context: stored runways
 * alone do not prove that a shortened sweep retains the source velocity.
 *
 * Two forward passes retain only per-sweep summaries, not a second full route
 * or an unbounded buffer of dark moves preceding the first painted point.
 */
export function buildLaserSecondPassProgram(
  sourceGcode: string,
  selection: LaserSecondPassSelection,
  options: { readonly writerVersion?: LaserSecondPassWriterVersion } = {},
): LaserSecondPassProgramResult {
  try {
    validateSelection(selection);
    const index = buildBrushIndex(selection);
    const version = options.writerVersion ?? LASER_SECOND_PASS_WRITER_VERSION;
    const program =
      version === 2
        ? writeTrimmedSweeps(sourceGcode, selection, index)
        : writeWholeSweeps(sourceGcode, selection, index, version === 3);
    return { kind: 'ready', ...program };
  } catch (error) {
    return { kind: 'error', message: errorMessage(error) };
  }
}

/** Writer 1 retains individual sweeps, byte-for-byte for old saved stages.
 * Writer 3 retains complete motion contexts between source synchronisations. */
function writeWholeSweeps(
  sourceGcode: string,
  selection: LaserSecondPassSelection,
  index: BrushIndex,
  preserveContext = false,
): ReturnType<typeof finishProgram> {
  const groups = new Set<number>();
  visitLaserSecondPassSource(sourceGcode, selection.initialPosition, (segment) => {
    const key = preserveContext ? segment.context : segment.group;
    if (segment.rapid || segment.power <= 0 || groups.has(key)) return;
    const intervals = partitionBrushPower(segment, index, selection.strokes);
    if (
      intervals.some(
        (interval) => selectedPower(segment.power, interval.scale, selection.maxPowerS) > 0,
      )
    ) {
      groups.add(key);
    }
  });
  const writer = createProgramWriter(selection, index, preserveContext, preserveContext);
  visitLaserSecondPassSource(sourceGcode, selection.initialPosition, (segment) => {
    const key = preserveContext ? segment.context : segment.group;
    if (!groups.has(key)) return;
    if (segment.rapid) {
      if (preserveContext) writeSourceRapid(writer, segment);
      return;
    }
    if (preserveContext) writeClippedSegment(writer, segment, 0, 1);
    else writeSourceSegment(writer, segment);
  });
  return finishProgram(writer);
}

function writeTrimmedSweeps(
  sourceGcode: string,
  selection: LaserSecondPassSelection,
  index: BrushIndex,
): ReturnType<typeof finishProgram> {
  const windows = measureSweepWindows(sourceGcode, selection, index);
  const writer = createProgramWriter(selection, index, true);
  const cursor = { group: -1, distanceMm: 0 };
  visitLaserSecondPassSource(sourceGcode, selection.initialPosition, (segment) => {
    if (segment.rapid) return;
    const window = windows.get(segment.group);
    if (window === undefined) return;
    if (cursor.group !== segment.group) {
      cursor.group = segment.group;
      cursor.distanceMm = 0;
    }
    // The same summation order as the measuring pass, so the window edges
    // land on the same path lengths.
    const length = segmentLengthMm(segment);
    const startMm = cursor.distanceMm;
    cursor.distanceMm += length;
    const t0 = clampedParameter(window.startMm, startMm, length);
    const t1 = clampedParameter(window.endMm, startMm, length);
    if (t1 > t0) writeClippedSegment(writer, segment, t0, t1);
  });
  return finishProgram(writer);
}
