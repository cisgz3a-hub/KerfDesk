// ADR-486 Amendment 4: Join paths and Close Path leave open a line drawn twice
// or a path out and back over itself, because closed it would be a loop with no
// area, which Kerf Offset drops from the job. Both say so in the same words.

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
