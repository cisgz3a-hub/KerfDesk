// LightBurn keeps a project's notes as `<Notes ShowOnLoad="0|1" Notes="…"/>`.
// They open as the project's notes, with the import report beneath them, so
// every line of the report stays with the project (ADR-388).

/** The project's notes: LightBurn's own, then the import report when it has lines. */
export function lightBurnProjectNotes(
  root: Element,
  sourceName: string,
  warnings: ReadonlyArray<string>,
): string {
  const report =
    warnings.length === 0
      ? ''
      : [`LightBurn import report for ${sourceName}:`, ...warnings.map((line) => `- ${line}`)].join(
          '\n',
        );
  return [ownNotes(root), report].filter((part) => part !== '').join('\n\n');
}

/** LightBurn shows the notes when the project opens; KerfDesk says where they are. */
export function lightBurnNotesWarnings(root: Element): string[] {
  const showOnLoad = notesElement(root)?.getAttribute('ShowOnLoad')?.trim().toLowerCase();
  if (ownNotes(root) === '' || (showOnLoad !== '1' && showOnLoad !== 'true')) return [];
  return [
    "LightBurn shows this project's notes when it opens: read them in Window > Project Notes.",
  ];
}

function ownNotes(root: Element): string {
  const notes = notesElement(root)?.getAttribute('Notes') ?? '';
  return notes.trim() === '' ? '' : notes.trimEnd();
}

function notesElement(root: Element): Element | undefined {
  return [...root.children].find((child) => child.tagName.toLowerCase() === 'notes');
}
