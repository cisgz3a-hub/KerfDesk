import { describe, expect, it } from 'vitest';
import {
  bufferTranscriptEntry,
  clearTranscriptBuffer,
  hasBufferedTranscript,
  publishTranscriptPatch,
  type TranscriptBufferRefs,
} from './laser-transcript-buffer';
import { LOG_MAX } from './laser-store-helpers';
import { TRANSCRIPT_MAX, type SerialTranscriptEntry } from './laser-transcript';

function entry(id: number, raw = `line-${id}`): SerialTranscriptEntry {
  return { id, at: id, direction: 'in', raw, kind: 'ok', source: 'job' };
}

const EMPTY = {
  log: [] as ReadonlyArray<string>,
  transcript: [] as ReadonlyArray<SerialTranscriptEntry>,
};

describe('laser transcript buffer (ADR-333)', () => {
  it('publishes buffered entries in order, ahead of the line that flushed them', () => {
    const refs: TranscriptBufferRefs = {};
    bufferTranscriptEntry(refs, entry(1), 'ok');
    bufferTranscriptEntry(refs, entry(2), 'ok');
    expect(hasBufferedTranscript(refs)).toBe(true);

    const patch = publishTranscriptPatch(refs, EMPTY, entry(3, '<Idle|...>'), '<Idle|...>');

    expect(patch.transcript.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(patch.log).toEqual(['ok', 'ok', '<Idle|...>']);
    expect(hasBufferedTranscript(refs)).toBe(false);
  });

  it('appends after what the store already holds', () => {
    const refs: TranscriptBufferRefs = {};
    bufferTranscriptEntry(refs, entry(2), 'ok');

    const patch = publishTranscriptPatch(
      refs,
      { log: ['earlier'], transcript: [entry(1, 'earlier')] },
      entry(3),
      'later',
    );

    expect(patch.transcript.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(patch.log).toEqual(['earlier', 'ok', 'later']);
  });

  it('publishes a flush with nothing buffered and nothing new as the same arrays', () => {
    const refs: TranscriptBufferRefs = {};
    const current = { log: ['a'], transcript: [entry(1)] };

    const patch = publishTranscriptPatch(refs, current);

    expect(patch.transcript).toBe(current.transcript);
    expect(patch.log).toBe(current.log);
  });

  it('honours the retention caps across a large batch', () => {
    const refs: TranscriptBufferRefs = {};
    for (let i = 0; i < TRANSCRIPT_MAX + 50; i += 1) bufferTranscriptEntry(refs, entry(i), `l${i}`);

    expect(refs.bufferedTranscript).toHaveLength(TRANSCRIPT_MAX);
    expect(refs.bufferedLog).toHaveLength(LOG_MAX);

    const patch = publishTranscriptPatch(refs, EMPTY);

    expect(patch.transcript).toHaveLength(TRANSCRIPT_MAX);
    expect(patch.transcript[0]?.id).toBe(50);
    expect(patch.transcript.at(-1)?.id).toBe(TRANSCRIPT_MAX + 49);
    expect(patch.log).toHaveLength(LOG_MAX);
    expect(patch.log[0]).toBe(`l${TRANSCRIPT_MAX + 50 - LOG_MAX}`);
    expect(patch.log.at(-1)).toBe(`l${TRANSCRIPT_MAX + 49}`);
  });

  it('requests publication after 250 ms of job-only traffic and resets the deadline', () => {
    const refs: TranscriptBufferRefs = {};
    expect(bufferTranscriptEntry(refs, { ...entry(1), at: 1_000 })).toBe(false);
    expect(bufferTranscriptEntry(refs, { ...entry(2), at: 1_249 })).toBe(false);
    expect(bufferTranscriptEntry(refs, { ...entry(3), at: 1_250 })).toBe(true);
    const published = publishTranscriptPatch(refs, EMPTY);
    expect(published.transcript.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(bufferTranscriptEntry(refs, { ...entry(4), at: 1_251 })).toBe(false);
    expect(publishTranscriptPatch(refs, published).transcript.map((item) => item.id)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('records an entry with no log line, for an outbound chunk the log never shows', () => {
    const refs: TranscriptBufferRefs = {};
    bufferTranscriptEntry(refs, { ...entry(1), direction: 'out', kind: 'gcode' });

    const patch = publishTranscriptPatch(refs, EMPTY, entry(2, '<Idle|...>'));

    expect(patch.transcript.map((item) => item.direction)).toEqual(['out', 'in']);
    expect(patch.log).toEqual([]);
  });

  it('drops what it holds when the session it belonged to ends', () => {
    const refs: TranscriptBufferRefs = {};
    bufferTranscriptEntry(refs, entry(1), 'ok');

    clearTranscriptBuffer(refs);

    expect(hasBufferedTranscript(refs)).toBe(false);
    expect(publishTranscriptPatch(refs, EMPTY).transcript).toEqual([]);
  });
});
