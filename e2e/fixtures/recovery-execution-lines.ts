import { expect, type KerfDeskFixture } from './kerfdesk-test';
import { programLinesSince, serialWriteLineCount, type FixtureEvents } from './recovery-flow';
import { acknowledgedStartControlLineNumbersSince } from './recovery-start-boundary';

interface WrittenLine {
  readonly ordinal: number;
  readonly eventIndex: number;
  readonly line: string;
  readonly standaloneWrite: string;
}

/** Keep the exact archived program and its terminal dwell. Separately witness
 * the new, acknowledged Start-control barrier instead of treating it as an
 * executable/archive line or blindly discarding every matching dwell. */
export function recoveryExecutionLinesSince(
  fixture: KerfDeskFixture,
  events: FixtureEvents,
  fromEventIndex: number,
): string[] {
  const baseline = serialWriteLineCount(events.slice(0, fromEventIndex));
  const controls = acknowledgedStartControlLineNumbersSince(fixture, baseline);
  expect(controls).toHaveLength(1);
  const written = writtenLines(events).filter((entry) => entry.eventIndex >= fromEventIndex);
  const observedControls = written.filter((entry) => controls.includes(entry.ordinal));
  expect(observedControls.map((entry) => entry.ordinal)).toEqual(controls);
  for (const entry of observedControls) {
    expect(entry.standaloneWrite).toBe('G4 P0.01\n');
    expect(entry.line).toBe('G4 P0.01');
    // The ledger records an ACK only while the owned Start queue fence is
    // pending. Its wire command must precede every executable program line.
    expect(written.filter((candidate) => candidate.ordinal < entry.ordinal)).toEqual([]);
  }
  return written
    .filter((entry) => !controls.includes(entry.ordinal))
    .map((entry) => entry.line)
    .filter((line) => line !== '');
}

function writtenLines(events: FixtureEvents): WrittenLine[] {
  let ordinal = 0;
  return events.flatMap((event, eventIndex) => {
    if (event['kind'] !== 'serial-write') return [];
    const text = String(event['text']);
    return text
      .split('\n')
      .slice(0, -1)
      .map((rawLine) => {
        ordinal += 1;
        return {
          ordinal,
          eventIndex,
          line: programLinesSince([{ kind: 'serial-write', text: `${rawLine}\n` }], 0)[0] ?? '',
          standaloneWrite: text,
        };
      });
  });
}
