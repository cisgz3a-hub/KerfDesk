import type { SerialTranscriptEntry, TranscriptSource } from './laser-transcript';

export type ConsoleCommandProvenance = {
  readonly kind: 'user-macro';
  readonly macroName: string;
  readonly macroTemplate: string;
};

export function consoleCommandTranscriptSource(
  provenance: ConsoleCommandProvenance | undefined,
): TranscriptSource {
  return provenance === undefined ? 'console' : 'macro';
}

/** Records the saved source without claiming a controller acknowledgement. */
export function macroDispatchTranscriptEntry(
  id: number,
  at: number,
  provenance: ConsoleCommandProvenance,
  command: string,
): SerialTranscriptEntry {
  return {
    id,
    at,
    direction: 'system',
    raw: `User macro ${JSON.stringify(provenance.macroName)} dispatched through Console: ${command}`,
    kind: 'message',
    source: 'macro',
  };
}
