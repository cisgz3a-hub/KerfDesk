import { buildBrushIndex, validateSelection, type BrushIndex } from './brush-index';
import { partitionBrushPower } from './brush-partition';
import {
  createProgramWriter,
  finishProgram,
  selectedPower,
  writeClippedSegment,
  writeSourceSegment,
} from './program-writer';
import { errorMessage, visitLaserSecondPassSource } from './source';
import { clampedParameter, measureSweepWindows, segmentLengthMm } from './sweep-window';
import type {
  LaserSecondPassProgramResult,
  LaserSecondPassSelection,
  LaserSecondPassWriterVersion,
} from './types';

/** The writer new painted passes use; saved stages record their own. */
export const LASER_SECOND_PASS_WRITER_VERSION: LaserSecondPassWriterVersion = 2;

/**
 * Derive a new pass from the exact archived bytes. Source sweeps retain their
 * original runways, direction, feed, and tonal modulation. Only painted motion
 * receives power; whole sweeps containing no selected burn are omitted.
 * Writer 2 also trims each selected sweep to its painted span plus the sweep's
 * own lead-in and lead-out (see sweep-window.ts).
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
      version === 1
        ? writeWholeSweeps(sourceGcode, selection, index)
        : writeTrimmedSweeps(sourceGcode, selection, index);
    return { kind: 'ready', ...program };
  } catch (error) {
    return { kind: 'error', message: errorMessage(error) };
  }
}

/** Writer 1, kept byte-for-byte for saved stages that recorded no writer. */
function writeWholeSweeps(
  sourceGcode: string,
  selection: LaserSecondPassSelection,
  index: BrushIndex,
): ReturnType<typeof finishProgram> {
  const groups = new Set<number>();
  visitLaserSecondPassSource(sourceGcode, selection.initialPosition, (segment) => {
    if (segment.rapid || segment.power <= 0 || groups.has(segment.group)) return;
    const intervals = partitionBrushPower(segment, index, selection.strokes);
    if (
      intervals.some(
        (interval) => selectedPower(segment.power, interval.scale, selection.maxPowerS) > 0,
      )
    ) {
      groups.add(segment.group);
    }
  });
  const writer = createProgramWriter(selection, index);
  visitLaserSecondPassSource(sourceGcode, selection.initialPosition, (segment) => {
    if (!segment.rapid && groups.has(segment.group)) writeSourceSegment(writer, segment);
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
