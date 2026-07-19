import type { SerialTranscriptEntry } from '../../state/laser-transcript';

// Grouping precedence matters: a job-stream write is direction 'out' AND
// source 'job', and a poll reply arrives as kind 'status' — the order of the
// checks below assigns each entry to exactly one group.

export type SuperConsoleGroup = 'errors' | 'stream' | 'status' | 'commands' | 'replies';

export const SUPER_CONSOLE_GROUPS: ReadonlyArray<{
  readonly id: SuperConsoleGroup;
  readonly label: string;
  readonly hint: string;
}> = [
  { id: 'errors', label: 'Errors', hint: 'error:N, ALARM:N, and locally blocked commands.' },
  {
    id: 'commands',
    label: 'Commands',
    hint: 'Commands the app or the console sent to the controller.',
  },
  { id: 'replies', label: 'Replies', hint: 'ok, settings lines, messages, and startup banners.' },
  { id: 'status', label: 'Status', hint: 'Periodic <...> status reports and poll traffic.' },
  { id: 'stream', label: 'Stream', hint: 'High-volume job stream writes.' },
];

export function groupForEntry(entry: SerialTranscriptEntry): SuperConsoleGroup {
  if (entry.kind === 'error' || entry.kind === 'alarm' || entry.kind === 'blocked') {
    return 'errors';
  }
  if (entry.source === 'job') return 'stream';
  if (entry.kind === 'status' || entry.source === 'poll') return 'status';
  if (entry.direction === 'out') return 'commands';
  return 'replies';
}

export type SuperConsoleFilter = {
  readonly groups: ReadonlySet<SuperConsoleGroup>;
  readonly search: string;
};

export function filterSuperConsoleEntries(
  entries: ReadonlyArray<SerialTranscriptEntry>,
  filter: SuperConsoleFilter,
): ReadonlyArray<SerialTranscriptEntry> {
  const needle = filter.search.trim().toLowerCase();
  return entries.filter((entry) => {
    if (!filter.groups.has(groupForEntry(entry))) return false;
    if (needle === '') return true;
    return [
      new Date(entry.at).toISOString(),
      entry.direction,
      entry.source,
      entry.kind,
      entry.raw,
      entry.decoded ?? '',
    ].some((value) => value.toLowerCase().includes(needle));
  });
}

export const SUPER_CONSOLE_TSV_HEADER = 'Timestamp\tDirection\tSource\tKind\tRaw\tDecoded';

export function formatSuperConsoleLine(entry: SerialTranscriptEntry): string {
  return [
    new Date(entry.at).toISOString(),
    entry.direction,
    entry.source,
    entry.kind,
    entry.raw,
    entry.decoded ?? '',
  ]
    .map(escapeTsvCell)
    .join('\t');
}

export function formatSuperConsoleTsv(entries: ReadonlyArray<SerialTranscriptEntry>): string {
  return [SUPER_CONSOLE_TSV_HEADER, ...entries.map(formatSuperConsoleLine)].join('\n');
}

function escapeTsvCell(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('\t', '\\t');
}
