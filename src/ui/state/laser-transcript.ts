import {
  classifyResponse,
  describeAlarm,
  describeError,
  type GrblResponse,
} from '../../core/controllers/grbl';

export const TRANSCRIPT_MAX = 500;

export type TranscriptDirection = 'in' | 'out' | 'system';
export type TranscriptKind =
  | 'status'
  | 'ok'
  | 'error'
  | 'alarm'
  | 'setting'
  | 'message'
  | 'welcome'
  | 'settings-query'
  | 'offset-query'
  | 'build-info-query'
  | 'modal-state-query'
  | 'unlock'
  | 'setting-write'
  | 'realtime'
  | 'gcode'
  | 'blocked'
  | 'unknown';
export type TranscriptSource =
  | 'controller'
  | 'console'
  | 'poll'
  | 'job'
  | 'motion'
  | 'setup'
  | 'origin'
  | 'system';

export type SerialTranscriptEntry = {
  readonly id: number;
  readonly at: number;
  readonly direction: TranscriptDirection;
  readonly raw: string;
  readonly kind: TranscriptKind;
  readonly source: TranscriptSource;
  readonly decoded?: string;
};

export function appendTranscript(
  transcript: ReadonlyArray<SerialTranscriptEntry>,
  entry: SerialTranscriptEntry,
): ReadonlyArray<SerialTranscriptEntry> {
  return [...transcript, entry].slice(-TRANSCRIPT_MAX);
}

export function inboundTranscriptEntry(id: number, at: number, raw: string): SerialTranscriptEntry {
  const response = classifyResponse(raw);
  return {
    id,
    at,
    direction: 'in',
    raw,
    kind: inboundKind(response),
    source: 'controller',
    ...decoded(response),
  };
}

export function outboundTranscriptEntry(
  id: number,
  at: number,
  raw: string,
  source: TranscriptSource,
): SerialTranscriptEntry {
  return {
    id,
    at,
    direction: 'out',
    raw,
    kind: outboundKind(raw),
    source,
  };
}

export function systemTranscriptEntry(
  id: number,
  at: number,
  raw: string,
  kind: TranscriptKind = 'blocked',
): SerialTranscriptEntry {
  return { id, at, direction: 'system', raw, kind, source: 'system' };
}

function inboundKind(response: GrblResponse): TranscriptKind {
  if (response.kind === 'status') return 'status';
  if (response.kind === 'ok') return 'ok';
  if (response.kind === 'error') return 'error';
  if (response.kind === 'alarm') return 'alarm';
  if (response.kind === 'setting') return 'setting';
  if (response.kind === 'message') return 'message';
  if (response.kind === 'welcome') return 'welcome';
  return 'unknown';
}

function outboundKind(raw: string): TranscriptKind {
  const trimmed = raw.trim();
  if (raw === '?' || raw === '\x18' || raw === '!' || raw === '~' || raw === '\x85') {
    return 'realtime';
  }
  if (trimmed === '$$') return 'settings-query';
  if (trimmed === '$#') return 'offset-query';
  if (trimmed.toUpperCase() === '$I') return 'build-info-query';
  if (trimmed.toUpperCase() === '$G') return 'modal-state-query';
  if (trimmed.toUpperCase() === '$X') return 'unlock';
  if (/^\$\d+=/.test(trimmed)) return 'setting-write';
  return 'gcode';
}

function decoded(response: GrblResponse): { readonly decoded: string } | Record<string, never> {
  if (response.kind === 'error') {
    const desc = describeError(response.code);
    return desc === null
      ? { decoded: `Error ${response.code}` }
      : { decoded: `${desc.title}: ${desc.detail}` };
  }
  if (response.kind === 'alarm') {
    const desc = describeAlarm(response.code);
    return desc === null
      ? { decoded: `Alarm ${response.code}` }
      : { decoded: `${desc.title}: ${desc.detail}` };
  }
  return {};
}
