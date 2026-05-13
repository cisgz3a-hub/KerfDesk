/**
 * T1-232: bounded structured diagnostic log for production pipeline events.
 *
 * These events are operational breadcrumbs that used to be written with
 * `console.log`. Keeping them structured makes them support-bundle-ready and
 * testable without depending on DevTools console capture.
 */

export type StructuredDiagnosticDomain =
  | 'controller'
  | 'optimizer'
  | 'storage'
  | 'materials'
  | 'unknown';

export interface StructuredDiagnosticLogEvent {
  readonly id: string;
  readonly timestamp: number;
  readonly domain: StructuredDiagnosticDomain;
  readonly event: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface StructuredDiagnosticLogInput {
  readonly domain: StructuredDiagnosticDomain;
  readonly event: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface StructuredDiagnosticLogSupportSnapshot {
  readonly schemaVersion: 1;
  readonly capturedAt: number;
  readonly entries: readonly StructuredDiagnosticLogEvent[];
}

export const STRUCTURED_DIAGNOSTIC_LOG_SCHEMA_VERSION = 1;
export const STRUCTURED_DIAGNOSTIC_LOG_MAX_ENTRIES = 1_000;

let nextStructuredDiagnosticLogId = 0;
const entries: StructuredDiagnosticLogEvent[] = [];

function makeStructuredDiagnosticLogId(timestamp: number): string {
  nextStructuredDiagnosticLogId += 1;
  return `diag_${timestamp}_${String(nextStructuredDiagnosticLogId).padStart(6, '0')}`;
}

export function appendStructuredDiagnosticLogEvent(
  input: StructuredDiagnosticLogInput,
  now: number = Date.now(),
): StructuredDiagnosticLogEvent {
  const event: StructuredDiagnosticLogEvent = {
    id: makeStructuredDiagnosticLogId(now),
    timestamp: now,
    domain: input.domain,
    event: input.event.trim() || 'diagnostic',
    message: input.message.trim() || 'Diagnostic event',
    details: input.details,
  };
  entries.push(event);
  while (entries.length > STRUCTURED_DIAGNOSTIC_LOG_MAX_ENTRIES) {
    entries.shift();
  }
  return event;
}

export function tailStructuredDiagnosticLogEvents(count: number): readonly StructuredDiagnosticLogEvent[] {
  if (count <= 0) return [];
  return entries.slice(-count);
}

export function serializeStructuredDiagnosticLogForSupport(
  capturedAt: number = Date.now(),
): StructuredDiagnosticLogSupportSnapshot {
  return {
    schemaVersion: STRUCTURED_DIAGNOSTIC_LOG_SCHEMA_VERSION,
    capturedAt,
    entries: entries.slice(),
  };
}

export function clearStructuredDiagnosticLogForTests(): void {
  entries.length = 0;
  nextStructuredDiagnosticLogId = 0;
}
