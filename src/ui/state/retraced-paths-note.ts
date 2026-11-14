// ADR-486 Amendment 4: Join paths and Close Path leave open a line drawn twice
// or a path out and back over itself, because closed it would be a loop with no
// area, which Kerf Offset drops from the job. Both say so in the same words.
//
// ADR-486 Amendment 5: a path Close Path does close, whose closing line runs
// back over part of its own line (a "P" closed down its stem), keeps an inside,
// so it is closed as asked, but Kerf Offset cuts only that inside. The toast
// says so; Job Review names the dropped line at compile.

export function retracedPathsNote(count: number): string {
  const one = count === 1;
  const which = one
    ? '1 path runs back over itself, so it stays open'
    : `${count} paths run back over themselves, so they stay open`;
  const why = one
    ? 'closed, it would enclose nothing and Kerf Offset would drop it from the job'
    : 'closed, they would enclose nothing and Kerf Offset would drop them from the job';
  return `${which}: ${why}. For a line drawn twice, use Delete Duplicates.`;
}

export function partlyRetracedNote(count: number, lengthMm: number): string {
  const one = count === 1;
  const length = lengthMm >= 10 ? Math.round(lengthMm) : Number(lengthMm.toFixed(1));
  const which = one
    ? `1 closed path runs back over about ${length} mm of its own line`
    : `${count} closed paths run back over about ${length} mm of their own line`;
  return `${which}: Kerf Offset cuts only the part that encloses area and leaves that line out, and without a kerf it burns twice. Undo leaves it open, burning as drawn.`;
}
