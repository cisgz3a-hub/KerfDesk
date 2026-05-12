/**
 * T1-208 (Phase 4): Ready mode — shown when the machine is idle,
 * gcode is fresh, preflight passes, and `canStartJob` is true.
 *
 * The Start Job button itself lives in the PrimaryActionFooter
 * (the panel-wide design: one big contextual button at the bottom).
 * This mode body is the "what you're about to run" summary card:
 * job name, line count, estimated time. Intentionally compact —
 * the user has already done their setup; this mode confirms what
 * the next click of Start will burn.
 */
import React from 'react';

const FONT = "'DM Sans', system-ui, sans-serif";

export interface ReadyModeProps {
  readonly jobName: string;
  readonly lineCount: number | null;
  readonly estimatedTime: string | null;
  readonly planSummary: string | null;
}

function summaryRowStyle(): React.CSSProperties {
  return {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '10px 14px',
    background: '#0d0d18',
    border: '1px solid #1f1f33',
    borderRadius: 6,
    fontSize: 13,
  };
}

export function ReadyMode({
  jobName,
  lineCount,
  estimatedTime,
  planSummary,
}: ReadyModeProps): React.ReactElement {
  return React.createElement(
    'div',
    {
      'data-testid': 'workflow-ready-mode',
      style: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto' as const,
        padding: '16px',
        display: 'flex',
        flexDirection: 'column' as const,
        gap: 12,
        fontFamily: FONT,
        color: '#e5e7eb',
      },
    },
    // Status banner — visible reinforcement that the machine is
    // ready and the next click runs the job.
    React.createElement(
      'div',
      {
        'data-testid': 'workflow-ready-banner',
        style: {
          padding: '12px 14px',
          background: 'rgba(52, 211, 153, 0.08)',
          border: '1px solid rgba(52, 211, 153, 0.42)',
          borderRadius: 6,
          color: '#34d399',
          fontSize: 13,
          fontWeight: 600,
          textAlign: 'center' as const,
        },
      },
      '✓ Ready to run',
    ),
    // Job name
    React.createElement(
      'div',
      { style: summaryRowStyle() },
      React.createElement('span', { style: { color: '#9ca3af' } }, 'Job'),
      React.createElement(
        'span',
        { style: { color: '#e5e7eb', fontWeight: 500, textAlign: 'right' as const, marginLeft: 12 } },
        jobName,
      ),
    ),
    // Line count
    lineCount !== null && React.createElement(
      'div',
      { style: summaryRowStyle() },
      React.createElement('span', { style: { color: '#9ca3af' } }, 'Lines'),
      React.createElement(
        'span',
        { style: { color: '#e5e7eb', fontWeight: 500 } },
        lineCount.toLocaleString(),
      ),
    ),
    // Estimated time
    estimatedTime !== null && React.createElement(
      'div',
      { style: summaryRowStyle() },
      React.createElement('span', { style: { color: '#9ca3af' } }, 'Estimated time'),
      React.createElement(
        'span',
        { style: { color: '#e5e7eb', fontWeight: 500 } },
        estimatedTime,
      ),
    ),
    // Plan summary (e.g. "Engrave → Cut" for multi-mode jobs)
    planSummary !== null && React.createElement(
      'div',
      { style: summaryRowStyle() },
      React.createElement('span', { style: { color: '#9ca3af' } }, 'Plan'),
      React.createElement(
        'span',
        { style: { color: '#e5e7eb', fontWeight: 500 } },
        planSummary,
      ),
    ),
    React.createElement(
      'div',
      {
        style: {
          fontSize: 11,
          color: '#6b7280',
          fontStyle: 'italic' as const,
          textAlign: 'center' as const,
          paddingTop: 6,
        },
      },
      'Press Start Job below to begin.',
    ),
  );
}
