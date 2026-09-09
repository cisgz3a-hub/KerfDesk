import { classifyResponse } from '../../core/controllers/grbl';
import { presentAlarm, presentError } from '../../core/controllers/grbl/response-presentation';
import type { ControllerEvent } from '../../core/controllers';
import type { ControllerKind } from '../../core/devices';

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
  | 'macro'
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

export function inboundTranscriptEntry(
  id: number,
  at: number,
  raw: string,
  // Callers on the live line path pass the active driver's classification;
  // the GRBL classifier is only the fallback for display-time/test use.
  response: ControllerEvent = classifyResponse(raw),
  controllerKind: ControllerKind = 'grbl-v1.1',
): SerialTranscriptEntry {
  return {
    id,
    at,
    direction: 'in',
    raw,
    kind: inboundKind(response),
    source: 'controller',
    ...decoded(response, controllerKind),
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

function inboundKind(response: ControllerEvent): TranscriptKind {
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

function decoded(
  response: ControllerEvent,
  controllerKind: ControllerKind,
): { readonly decoded: string } | Record<string, never> {
  if (response.kind === 'error') {
    if (response.code === null) {
      return { decoded: `Unrecognized controller error: ${response.raw ?? 'error'}` };
    }
    const desc = presentError(controllerKind, response.code);
    return desc === null
      ? { decoded: `Error ${response.code}` }
      : { decoded: desc.detail === undefined ? desc.title : `${desc.title}: ${desc.detail}` };
  }
  if (response.kind === 'alarm') {
    const desc = presentAlarm(controllerKind, response.code);
    return desc === null
      ? { decoded: `Alarm ${response.code}` }
      : { decoded: desc.detail === undefined ? desc.title : `${desc.title}: ${desc.detail}` };
  }
  return {};
}
