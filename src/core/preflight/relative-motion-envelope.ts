// Relative-origin motion envelope — extracted from preflight.ts at the file
// size cap. For jobs placed relative to a user origin the absolute machine
// position is unknown, so bounds checking degrades to a SPAN check: the job's
// total X/Y motion extent must fit the bed even at the worst-case placement.
import { isGcodeMotionCommand, parseGcodeWord, stripGcodeComment } from '../invariants';

export function findRelativeMotionEnvelopeIssues(
  gcode: string,
  bed: { readonly width: number; readonly height: number },
): ReadonlyArray<string> {
  const bounds = collectRelativeMotionEnvelope(gcode);
  if (bounds === null) return [];
  const issues: string[] = [];
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width > bed.width) {
    issues.push(
      `Relative job motion spans ${width.toFixed(3)} mm in X, exceeding the ${bed.width} mm bed width. Scale the artwork down or reduce overscan.`,
    );
  }
  if (height > bed.height) {
    issues.push(
      `Relative job motion spans ${height.toFixed(3)} mm in Y, exceeding the ${bed.height} mm bed height. Scale the artwork down.`,
    );
  }
  return issues;
}

function collectRelativeMotionEnvelope(gcode: string): {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
} | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const raw of gcode.split('\n')) {
    const stripped = stripGcodeComment(raw);
    if (!isGcodeMotionCommand(stripped)) continue;
    const x = parseGcodeWord(stripped, 'X');
    const y = parseGcodeWord(stripped, 'Y');
    if (x !== null) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      any = true;
    }
    if (y !== null) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      any = true;
    }
  }
  return any ? { minX, minY, maxX, maxY } : null;
}
