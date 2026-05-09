import React from 'react';
import {
  filterStructuredLogEvents,
  formatStructuredLogEventDetails,
  formatStructuredLogEventTime,
  type StructuredLogDomain,
  type StructuredLogEvent,
  type StructuredLogSeverity,
} from '../../../app/StructuredMessageLog';

interface StructuredLogPanelProps {
  readonly events: readonly StructuredLogEvent[];
}

const font = "'DM Sans', system-ui, sans-serif";
const mono = "'JetBrains Mono', monospace";

const severityOptions: Array<{ value: StructuredLogSeverity | 'all'; label: string }> = [
  { value: 'all', label: 'All severities' },
  { value: 'warning', label: 'Warning+' },
  { value: 'error', label: 'Error+' },
  { value: 'critical', label: 'Critical' },
];
const DOMAIN_FILTER_KEY = 'laserforge.structuredLog.domain';
const SEVERITY_FILTER_KEY = 'laserforge.structuredLog.minimumSeverity';

const severityColor: Record<StructuredLogSeverity, string> = {
  info: '#8888aa',
  warning: '#ffd444',
  error: '#ff4466',
  critical: '#ff4466',
};

function collectDomains(events: readonly StructuredLogEvent[]): Array<StructuredLogDomain | 'all'> {
  const domains = new Set<StructuredLogDomain>();
  for (const event of events) domains.add(event.domain);
  return ['all', ...Array.from(domains).sort()];
}

function displaySeverity(severity: StructuredLogSeverity): string {
  return severity === 'info' ? 'info' : severity;
}

function readStoredFilter<T extends string>(key: string, fallback: T): T {
  try {
    if (typeof window === 'undefined') return fallback;
    return (window.localStorage.getItem(key) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStoredFilter(key: string, value: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value);
  } catch {
    /* storage is best-effort */
  }
}

export function StructuredLogPanel({ events }: StructuredLogPanelProps) {
  const [domain, setDomain] = React.useState<StructuredLogDomain | 'all'>(() =>
    readStoredFilter<StructuredLogDomain | 'all'>(DOMAIN_FILTER_KEY, 'all'),
  );
  const [minimumSeverity, setMinimumSeverity] = React.useState<StructuredLogSeverity | 'all'>(() =>
    readStoredFilter<StructuredLogSeverity | 'all'>(SEVERITY_FILTER_KEY, 'all'),
  );
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const domains = collectDomains(events);
  const domainOptions = domain !== 'all' && !domains.includes(domain) ? [...domains, domain] : domains;
  const visibleEvents = filterStructuredLogEvents(events, { domain, minimumSeverity }).slice(-200);

  React.useEffect(() => {
    writeStoredFilter(DOMAIN_FILTER_KEY, domain);
  }, [domain]);
  React.useEffect(() => {
    writeStoredFilter(SEVERITY_FILTER_KEY, minimumSeverity);
  }, [minimumSeverity]);

  return React.createElement('section', {
    'data-testid': 'structured-log-panel',
    style: {
      border: '1px solid #1a1a2e',
      borderRadius: 6,
      background: '#08080f',
      overflow: 'hidden',
      fontFamily: font,
    },
  },
    React.createElement('div', {
      style: {
        padding: '8px 10px',
        borderBottom: '1px solid #1a1a2e',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      },
    },
      React.createElement('div', {
        style: {
          color: '#c0c0d0',
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase' as const,
          letterSpacing: 0,
          marginRight: 'auto',
        },
      }, 'Log'),
      React.createElement('select', {
        'data-testid': 'structured-log-domain-filter',
        value: domain,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setDomain(e.target.value as StructuredLogDomain | 'all'),
        style: {
          maxWidth: 116,
          padding: '5px 6px',
          borderRadius: 5,
          background: '#0d0d18',
          border: '1px solid #252540',
          color: '#c0c0d0',
          fontSize: 10,
          fontFamily: font,
        },
      },
        domainOptions.map(value => React.createElement('option', { key: value, value },
          value === 'all' ? 'All domains' : value,
        )),
      ),
      React.createElement('select', {
        'data-testid': 'structured-log-severity-filter',
        value: minimumSeverity,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setMinimumSeverity(e.target.value as StructuredLogSeverity | 'all'),
        style: {
          maxWidth: 116,
          padding: '5px 6px',
          borderRadius: 5,
          background: '#0d0d18',
          border: '1px solid #252540',
          color: '#c0c0d0',
          fontSize: 10,
          fontFamily: font,
        },
      },
        severityOptions.map(option => React.createElement('option', { key: option.value, value: option.value }, option.label)),
      ),
    ),
    React.createElement('div', {
      style: {
        minHeight: 72,
        maxHeight: 220,
        overflowY: 'auto' as const,
        padding: 8,
      },
    },
      visibleEvents.length === 0
        ? React.createElement('div', {
            style: { color: '#444460', fontSize: 10, fontFamily: mono },
          }, events.length === 0 ? 'Console...' : 'No log entries match the filters.')
        : visibleEvents.map(event => {
            const expanded = expandedId === event.id;
            return React.createElement('div', {
              key: event.id,
              'data-testid': 'structured-log-event',
              style: {
                padding: '7px 6px',
                borderBottom: '1px solid rgba(37,37,64,0.7)',
              },
            },
              React.createElement('button', {
                type: 'button',
                onClick: () => setExpandedId(expanded ? null : event.id),
                style: {
                  width: '100%',
                  padding: 0,
                  border: 0,
                  background: 'transparent',
                  color: '#c0c0d0',
                  cursor: 'pointer',
                  display: 'grid',
                  gridTemplateColumns: '54px 1fr',
                  gap: 8,
                  textAlign: 'left' as const,
                  fontFamily: font,
                },
              },
                React.createElement('span', {
                  style: { color: '#555570', fontSize: 10, fontFamily: mono },
                }, formatStructuredLogEventTime(event.timestamp)),
                React.createElement('span', { style: { minWidth: 0 } },
                  React.createElement('span', {
                    style: {
                      color: severityColor[event.severity],
                      fontSize: 10,
                      fontFamily: mono,
                      marginRight: 6,
                    },
                  }, `${event.domain}/${displaySeverity(event.severity)}`),
                  React.createElement('span', {
                    style: {
                      color: '#e0e0ec',
                      fontSize: 11,
                      fontWeight: 700,
                    },
                  }, event.title),
                ),
              ),
              expanded && React.createElement('pre', {
                'data-testid': 'structured-log-event-details',
                style: {
                  margin: '6px 0 0 62px',
                  whiteSpace: 'pre-wrap' as const,
                  color: '#8888aa',
                  fontFamily: mono,
                  fontSize: 10,
                  lineHeight: 1.45,
                },
              }, formatStructuredLogEventDetails(event)),
            );
          }),
    ),
  );
}
