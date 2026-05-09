import { type ErrorDomain, type ErrorSeverity, type UserFacingError } from './ErrorReporter';

export type StructuredLogDomain = ErrorDomain | 'ui' | 'unknown';
export type StructuredLogSeverity = ErrorSeverity;

export interface StructuredLogEvent {
  readonly id: string;
  readonly timestamp: number;
  readonly domain: StructuredLogDomain;
  readonly severity: StructuredLogSeverity;
  readonly title: string;
  readonly message: string;
  readonly recoverySteps?: readonly string[];
  readonly developerDetails?: unknown;
  readonly legacyText?: string;
}

export interface StructuredLogFilter {
  readonly domain?: StructuredLogDomain | 'all';
  readonly severity?: StructuredLogSeverity | 'all';
  readonly minimumSeverity?: StructuredLogSeverity | 'all';
}

export type StructuredLogEventInput =
  Omit<StructuredLogEvent, 'id' | 'timestamp'> & {
    readonly id?: string;
    readonly timestamp?: number;
  };

const SEVERITY_RANK: Record<StructuredLogSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

let nextStructuredLogEventId = 0;

export function resetStructuredLogEventIdsForTests(): void {
  nextStructuredLogEventId = 0;
}

function createStructuredLogEventId(timestamp: number): string {
  nextStructuredLogEventId += 1;
  return `log_${timestamp}_${String(nextStructuredLogEventId).padStart(6, '0')}`;
}

export function severityMeetsMinimum(
  severity: StructuredLogSeverity,
  minimum: StructuredLogSeverity | 'all' | undefined,
): boolean {
  if (!minimum || minimum === 'all') return true;
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[minimum];
}

export function normalizeStructuredLogEvent(
  input: StructuredLogEventInput,
  now: number = Date.now(),
): StructuredLogEvent {
  const timestamp = input.timestamp ?? now;
  return {
    id: input.id ?? createStructuredLogEventId(timestamp),
    timestamp,
    domain: input.domain,
    severity: input.severity,
    title: input.title.trim() || input.message.trim() || 'Log event',
    message: input.message.trim() || input.title.trim() || 'No details provided.',
    recoverySteps: input.recoverySteps ? [...input.recoverySteps] : undefined,
    developerDetails: input.developerDetails,
    legacyText: input.legacyText,
  };
}

export function legacyMessageToStructuredLogEvent(
  message: string,
  now: number = Date.now(),
): StructuredLogEvent {
  const visible = message.trim() || '(blank message)';
  return normalizeStructuredLogEvent(
    {
      domain: 'system',
      severity: 'info',
      title: visible,
      message: visible,
      legacyText: message,
    },
    now,
  );
}

export function structuredLogEventFromError(
  error: UserFacingError,
): StructuredLogEvent {
  return normalizeStructuredLogEvent({
    id: error.id,
    timestamp: error.timestamp,
    domain: error.domain,
    severity: error.severity,
    title: error.title,
    message: error.message,
    recoverySteps: error.recoverySteps,
    developerDetails: error.developerDetails,
  });
}

export function formatStructuredLogEventForLegacy(event: StructuredLogEvent): string {
  if (event.legacyText != null) return event.legacyText;
  if (event.title === event.message) return event.message;
  return `${event.title}: ${event.message}`;
}

export function filterStructuredLogEvents(
  events: readonly StructuredLogEvent[],
  filter: StructuredLogFilter = {},
): StructuredLogEvent[] {
  return events.filter(event => {
    if (filter.domain && filter.domain !== 'all' && event.domain !== filter.domain) return false;
    if (filter.severity && filter.severity !== 'all' && event.severity !== filter.severity) return false;
    if (!severityMeetsMinimum(event.severity, filter.minimumSeverity)) return false;
    return true;
  });
}

export function formatStructuredLogEventTime(timestamp: number): string {
  const d = new Date(timestamp);
  const hh = d.getUTCHours().toString().padStart(2, '0');
  const mm = d.getUTCMinutes().toString().padStart(2, '0');
  const ss = d.getUTCSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function formatStructuredLogEventDetails(event: StructuredLogEvent): string {
  const lines = [event.message];
  if (event.recoverySteps && event.recoverySteps.length > 0) {
    lines.push('Recovery');
    for (const step of event.recoverySteps) lines.push(`- ${step}`);
  }
  if (event.developerDetails != null) {
    lines.push('Developer details');
    try {
      lines.push(JSON.stringify(event.developerDetails, null, 2));
    } catch {
      lines.push(String(event.developerDetails));
    }
  }
  return lines.join('\n');
}
