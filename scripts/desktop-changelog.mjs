// CHANGELOG.md sections for desktop Previews (ADR-522). Unreleased holds
// hand-written highlights and a generated list of every change between two
// markers; scripts/desktop-release-notes.mjs fills the list and stamps
// Unreleased as a version before it is tagged.

export const CHANGES_START = '<!-- changes:start -->';
export const CHANGES_END = '<!-- changes:end -->';

/** The body under `## <version>` (or `## Unreleased`), or null when there is none. */
export function changelogSection(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.findIndex(
    (line) => line === `## ${version}` || line.startsWith(`## ${version} `),
  );
  if (start === -1) return null;
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
}

/** The newest `## <version>` heading below Unreleased. */
export function newestReleasedVersion(changelog) {
  return /^## (\d+\.\d+\.\d+\S*)/m.exec(changelog)?.[1] ?? null;
}

/** Hand-written Unreleased highlights, or '' when there are none yet. */
export function unreleasedHighlights(changelog) {
  const unreleased = changelogSection(changelog, 'Unreleased') ?? '';
  const highlights = /### Highlights\n([\s\S]*?)(?=\n### |$)/.exec(unreleased)?.[1].trim() ?? '';
  return highlights === '- Nothing yet.' ? '' : highlights;
}

/**
 * A Preview's release notes: its CHANGELOG section when it was stamped, else
 * the Unreleased highlights and the `generated` list of every pull request.
 */
export function releaseBody(changelog, version, generated) {
  const section = changelogSection(changelog, version);
  if (section !== null) return section;
  const highlights = unreleasedHighlights(changelog);
  return [
    highlights === '' ? '' : `### Highlights\n\n${highlights}`,
    `### All changes\n\n${generated}`,
  ]
    .filter((part) => part !== '')
    .join('\n\n');
}

/** Replaces the generated block of the Unreleased section. */
export function refreshUnreleased(changelog, generated) {
  const start = changelog.indexOf(CHANGES_START);
  const end = changelog.indexOf(CHANGES_END);
  const unreleased = changelog.indexOf('## Unreleased');
  const next = changelog.indexOf('\n## ', unreleased + 1);
  if (unreleased === -1 || start < unreleased || end < start || (next !== -1 && end > next)) {
    throw new Error(
      'CHANGELOG.md needs an Unreleased section holding the generated-changes markers',
    );
  }
  return `${changelog.slice(0, start + CHANGES_START.length)}\n${generated}\n${changelog.slice(end)}`;
}

/**
 * Unreleased becomes `version`'s section. `missed` holds generated-only
 * sections for Previews tagged without a stamp, newest first.
 */
export function stampChangelog(changelog, { version, date, generated, missed = [] }) {
  // The markers stay with Unreleased; the released list is plain text.
  const refreshed = refreshUnreleased(changelog, generated)
    .replace(`${CHANGES_START}\n`, '')
    .replace(`\n${CHANGES_END}`, '');
  const fresh = [
    '## Unreleased',
    '',
    '### Highlights',
    '',
    '- Nothing yet.',
    '',
    '### All changes',
    '',
    CHANGES_START,
    CHANGES_END,
    '',
    `## ${version} - ${date}`,
  ].join('\n');
  const stamped = refreshed.replace('## Unreleased', fresh);
  if (missed.length === 0) return stamped;
  const older = missed
    .map((section) => `## ${section.version} - ${section.date}\n\n${section.generated}\n`)
    .join('\n');
  const released = stamped.indexOf(`## ${version} - ${date}`);
  const next = stamped.indexOf('\n## ', released + 1);
  return next === -1
    ? `${stamped.trimEnd()}\n\n${older}`
    : `${stamped.slice(0, next + 1)}${older}\n${stamped.slice(next + 1)}`;
}
