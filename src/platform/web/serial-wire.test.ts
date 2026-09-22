import { describe, expect, it } from 'vitest';
import { extractSerialLines, MAX_SERIAL_LINE_LENGTH } from './serial-wire';

function readChunks(chunks: ReadonlyArray<string>): ReadonlyArray<string> {
  let state = { buffer: '', discarding: false };
  const lines: string[] = [];
  for (const chunk of chunks) {
    const result = extractSerialLines(state, chunk);
    state = result.state;
    lines.push(...result.lines);
    expect(state.buffer.length).toBeLessThanOrEqual(MAX_SERIAL_LINE_LENGTH + 1);
    if (state.discarding) expect(state.buffer).toBe('');
  }
  return lines;
}

describe('bounded serial record framing', () => {
  it('matches whole-record parsing for different chunk partitions at the length boundary', () => {
    const max = MAX_SERIAL_LINE_LENGTH;
    const wire = [
      'ok',
      'A'.repeat(max - 1),
      `${'B'.repeat(max)}\r`,
      `${'C'.repeat(max + 1)}ok`,
      `${'D'.repeat(max)}\r\r`,
      'error:14',
      '<Idle|MPos:0,0,0>',
      '',
    ].join('\n');
    // Independent oracle sees complete records, with no buffering algorithm.
    const expected = wire
      .split('\n')
      .slice(0, -1)
      .map((line) => line.replace(/\r$/, ''))
      .filter((line) => line.length <= max);
    for (const size of [1, 127, max - 1, max, max + 1, wire.length]) {
      const chunks = [];
      for (let start = 0; start < wire.length; start += size)
        chunks.push(wire.slice(start, start + size));
      expect(readChunks(chunks)).toEqual(expected);
    }
  });

  it('discards any number of suffix reads until the same record actually ends', () => {
    const first = extractSerialLines(
      { buffer: '', discarding: false },
      'X'.repeat(MAX_SERIAL_LINE_LENGTH + 1),
    );
    expect(first.state).toEqual({ buffer: '', discarding: true });
    const suffix = extractSerialLines(first.state, 'ok');
    expect(suffix.lines).toEqual([]);
    expect(suffix.state).toEqual(first.state);
    expect(extractSerialLines(suffix.state, '\r\nok\n')).toEqual({
      lines: ['ok'],
      state: { buffer: '', discarding: false },
    });
  });

  it('accepts exactly one terminal CR without changing the record-length limit', () => {
    const body = 'X'.repeat(MAX_SERIAL_LINE_LENGTH);
    expect(readChunks([body, '\r', '\n'])).toEqual([body]);
    expect(readChunks([body, '\r', 'ok\n'])).toEqual([]);
    expect(readChunks([body, '\r', '\r', '\n', 'ok\n'])).toEqual(['ok']);
  });

  it('does not share discard mode with a new connection', () => {
    expect(readChunks(['X'.repeat(MAX_SERIAL_LINE_LENGTH + 1), 'ok\n'])).toEqual([]);
    expect(readChunks(['ok\n'])).toEqual(['ok']);
  });
});
