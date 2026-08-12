import type { SerialTranscriptEntry, TranscriptSource } from './laser-transcript';

const MACRO_DISPATCH_MESSAGE = (macroName: string, command: string): string =>
  `User macro ${JSON.stringify(macroName)} dispatched through Console: ${command}`;

/** Provenance attached when a saved one-command macro delegates to the existing Console path. */
export type ConsoleCommandProvenance = {
  readonly kind: 'user-macro';
  readonly macroName: string;
  readonly macroTemplate: string;
};

/** Maps an optional saved-macro provenance record to the truthful transcript source label. */
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
    raw: MACRO_DISPATCH_MESSAGE(provenance.macroName, command),
    kind: 'message',
    source: 'macro',
  };
}
