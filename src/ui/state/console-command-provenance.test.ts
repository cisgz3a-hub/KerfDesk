import { describe, expect, it } from 'vitest';
import {
  consoleCommandTranscriptSource,
  macroDispatchTranscriptEntry,
  type ConsoleCommandProvenance,
} from './console-command-provenance';

const provenance: ConsoleCommandProvenance = {
  kind: 'user-macro',
  macroName: 'Nudge "X"',
  macroTemplate: 'G0 X{{distance}}',
};

describe('console command provenance', () => {
  it('distinguishes manual Console and saved user-macro writes', () => {
    expect(consoleCommandTranscriptSource(undefined)).toBe('console');
    expect(consoleCommandTranscriptSource(provenance)).toBe('macro');
  });

  it('records a truthful single-line expansion message', () => {
    expect(macroDispatchTranscriptEntry(4, 10, provenance, 'G0 X2.5')).toEqual({
      id: 4,
      at: 10,
      direction: 'system',
      raw: 'User macro "Nudge \\"X\\"" dispatched through Console: G0 X2.5',
      kind: 'message',
      source: 'macro',
    });
  });
});
