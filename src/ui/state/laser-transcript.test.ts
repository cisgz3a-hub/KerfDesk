import { describe, expect, it } from 'vitest';
import {
  appendTranscript,
  inboundTranscriptEntry,
  outboundTranscriptEntry,
  TRANSCRIPT_MAX,
  type SerialTranscriptEntry,
} from './laser-transcript';

describe('laser transcript', () => {
  it('classifies inbound GRBL lines without dropping the raw text', () => {
    expect(inboundTranscriptEntry(1, 100, '<Idle|MPos:0.000,0.000,0.000|FS:0,0>')).toMatchObject({
      id: 1,
      at: 100,
      direction: 'in',
      raw: '<Idle|MPos:0.000,0.000,0.000|FS:0,0>',
      kind: 'status',
      source: 'controller',
    });
    expect(inboundTranscriptEntry(2, 101, 'error:8')).toMatchObject({
      kind: 'error',
      decoded: 'Not idle: The command needs the controller to be idle.',
    });
    expect(inboundTranscriptEntry(22, 101, 'error:7002009')).toMatchObject({
      kind: 'error',
      decoded: 'Unrecognized controller error: error:7002009',
    });
    expect(inboundTranscriptEntry(3, 102, 'ALARM:1')).toMatchObject({
      kind: 'alarm',
      decoded: expect.stringContaining('Hard limit'),
    });
  });

  it('classifies outbound payloads by source and command shape', () => {
    expect(outboundTranscriptEntry(1, 100, '?', 'poll')).toMatchObject({
      direction: 'out',
      raw: '?',
      kind: 'realtime',
      source: 'poll',
    });
    expect(outboundTranscriptEntry(2, 101, '$$\n', 'console')).toMatchObject({
      kind: 'settings-query',
      source: 'console',
    });
    expect(outboundTranscriptEntry(3, 102, 'G1 X1\nG1 X2\n', 'job')).toMatchObject({
      kind: 'gcode',
      source: 'job',
    });
  });

  it('keeps transcript entries bounded', () => {
    let transcript: ReadonlyArray<SerialTranscriptEntry> = [];
    for (let i = 0; i < TRANSCRIPT_MAX + 3; i += 1) {
      transcript = appendTranscript(transcript, {
        id: i,
        at: i,
        direction: 'in',
        raw: `ok-${i}`,
        kind: 'ok',
        source: 'controller',
      });
    }

    expect(transcript).toHaveLength(TRANSCRIPT_MAX);
    expect(transcript[0]?.raw).toBe('ok-3');
  });
});
