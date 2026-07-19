import { describe, expect, it } from 'vitest';
import type { SerialTranscriptEntry } from '../../state/laser-transcript';
import {
  filterSuperConsoleEntries,
  formatSuperConsoleLine,
  formatSuperConsoleTsv,
  groupForEntry,
  SUPER_CONSOLE_GROUPS,
  type SuperConsoleGroup,
} from './super-console-filters';

function entry(
  overrides: Partial<SerialTranscriptEntry> & { readonly id: number },
): SerialTranscriptEntry {
  return {
    at: overrides.id,
    direction: 'in',
    raw: 'ok',
    kind: 'ok',
    source: 'controller',
    ...overrides,
  };
}

const allGroups: ReadonlySet<SuperConsoleGroup> = new Set(
  SUPER_CONSOLE_GROUPS.map((group) => group.id),
);

describe('groupForEntry', () => {
  it('classifies errors ahead of every other group', () => {
    expect(groupForEntry(entry({ id: 1, kind: 'error' }))).toBe('errors');
    expect(groupForEntry(entry({ id: 2, kind: 'alarm', source: 'poll' }))).toBe('errors');
    expect(
      groupForEntry(entry({ id: 3, kind: 'blocked', direction: 'system', source: 'system' })),
    ).toBe('errors');
    // An error observed during a job stream is still an error, not stream noise.
    expect(groupForEntry(entry({ id: 4, kind: 'error', source: 'job' }))).toBe('errors');
  });

  it('classifies job-stream writes as stream, not commands, despite direction out', () => {
    expect(groupForEntry(entry({ id: 1, direction: 'out', kind: 'gcode', source: 'job' }))).toBe(
      'stream',
    );
  });

  it('classifies status reports and poll traffic as status', () => {
    expect(groupForEntry(entry({ id: 1, kind: 'status' }))).toBe('status');
    expect(
      groupForEntry(entry({ id: 2, kind: 'realtime', direction: 'out', source: 'poll' })),
    ).toBe('status');
  });

  it('classifies remaining outbound lines as commands and inbound lines as replies', () => {
    expect(
      groupForEntry(entry({ id: 1, direction: 'out', kind: 'settings-query', source: 'console' })),
    ).toBe('commands');
    expect(groupForEntry(entry({ id: 2, kind: 'setting' }))).toBe('replies');
    expect(groupForEntry(entry({ id: 3, kind: 'welcome' }))).toBe('replies');
  });
});

describe('filterSuperConsoleEntries', () => {
  const entries = [
    entry({
      id: 1,
      kind: 'error',
      raw: 'error:20',
      decoded: 'Unsupported command: M7 needs mist coolant.',
    }),
    entry({ id: 2, direction: 'out', kind: 'settings-query', source: 'console', raw: '$$' }),
    entry({ id: 3, kind: 'setting', raw: '$32=1' }),
    entry({ id: 4, kind: 'status', raw: '<Idle|MPos:0,0,0>' }),
  ];

  it('keeps only entries whose group is enabled', () => {
    const groups = new Set<SuperConsoleGroup>(['errors', 'replies']);
    const visible = filterSuperConsoleEntries(entries, { groups, search: '' });
    expect(visible.map((e) => e.id)).toEqual([1, 3]);
  });

  it('matches search text case-insensitively across every displayed column', () => {
    expect(
      filterSuperConsoleEntries(entries, { groups: allGroups, search: '$32' }).map((e) => e.id),
    ).toEqual([3]);
    expect(
      filterSuperConsoleEntries(entries, { groups: allGroups, search: 'MIST' }).map((e) => e.id),
    ).toEqual([1]);
    expect(
      filterSuperConsoleEntries(entries, { groups: allGroups, search: 'console' }).map((e) => e.id),
    ).toEqual([2]);
    expect(
      filterSuperConsoleEntries(entries, { groups: allGroups, search: 'settings-query' }).map(
        (e) => e.id,
      ),
    ).toEqual([2]);
  });

  it('returns everything when all groups are on and search is blank', () => {
    expect(filterSuperConsoleEntries(entries, { groups: allGroups, search: ' ' })).toHaveLength(4);
  });
});

describe('Super console TSV formatting', () => {
  it('includes an ISO timestamp and every detail column', () => {
    expect(
      formatSuperConsoleLine(
        entry({ id: 1, kind: 'error', raw: 'error:9', decoded: 'Homing fail' }),
      ),
    ).toBe('1970-01-01T00:00:00.001Z\tin\tcontroller\terror\terror:9\tHoming fail');
    expect(formatSuperConsoleLine(entry({ id: 2, raw: 'ok' }))).toBe(
      '1970-01-01T00:00:00.002Z\tin\tcontroller\tok\tok\t',
    );
  });

  it('pins the header and escapes control characters so one entry stays one row', () => {
    expect(
      formatSuperConsoleTsv([
        entry({ id: 3, raw: '$I\tvalue', decoded: 'line one\r\nline two\\tail' }),
      ]),
    ).toBe(
      'Timestamp\tDirection\tSource\tKind\tRaw\tDecoded\n' +
        '1970-01-01T00:00:00.003Z\tin\tcontroller\tok\t$I\\tvalue\tline one\\r\\nline two\\\\tail',
    );
  });
});
