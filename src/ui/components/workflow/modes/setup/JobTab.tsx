/**
 * T1-207 (Phase 3): Job tab in the setup mode.
 *
 * Phase 3 shows the active device profile, the resolved machine
 * bed size, the scene's compiled-status (gcode fresh vs stale),
 * and a recompile button when stale. The full layer-overview
 * cards + start-mode selector + saved-origin status are scheduled
 * for a Phase 3 follow-up — they need scene state + canvas
 * context that's threaded deeper in the panel. The minimal Job
 * tab is still useful: it surfaces "which device, which bed, is
 * my gcode fresh" — the four things users check most before
 * starting a job.
 */
import React from 'react';
import type { DeviceProfile } from '../../../../../core/devices/DeviceProfile';

const FONT = "'DM Sans', system-ui, sans-serif";

export interface JobTabProps {
  readonly activeProfile: DeviceProfile | null;
  readonly resolvedBedWidthMm: number;
  readonly resolvedBedHeightMm: number;
  readonly gcodeLoaded: boolean;
  readonly gcodeStale: boolean;
  readonly onRecompile: (() => void) | null;
}

function summaryRowStyle(): React.CSSProperties {
  return {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 12px',
    background: '#0d0d18',
    border: '1px solid #1f1f33',
    borderRadius: 4,
    fontSize: 12,
  };
}

export function JobTab({
  activeProfile,
  resolvedBedWidthMm,
  resolvedBedHeightMm,
  gcodeLoaded,
  gcodeStale,
  onRecompile,
}: JobTabProps): React.ReactElement {
  const gcodeLabel = !gcodeLoaded
    ? 'Not compiled'
    : gcodeStale
      ? 'Stale (recompile)'
      : 'Fresh';
  const gcodeColor = !gcodeLoaded ? '#9ca3af' : gcodeStale ? '#fbbf24' : '#34d399';

  return React.createElement(
    'div',
    {
      'data-testid': 'workflow-setup-job-tab',
      style: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto' as const,
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column' as const,
        gap: 10,
        fontFamily: FONT,
        color: '#e5e7eb',
      },
    },
    // Active profile row
    React.createElement(
      'div',
      { style: summaryRowStyle() },
      React.createElement('span', { style: { color: '#9ca3af' } }, 'Device profile'),
      React.createElement(
        'span',
        { style: { color: '#e5e7eb', fontWeight: 500 } },
        activeProfile?.name ?? '— none selected —',
      ),
    ),
    // Bed size row
    React.createElement(
      'div',
      { style: summaryRowStyle() },
      React.createElement('span', { style: { color: '#9ca3af' } }, 'Bed size'),
      React.createElement(
        'span',
        { style: { color: '#e5e7eb', fontWeight: 500 } },
        `${resolvedBedWidthMm.toFixed(0)} × ${resolvedBedHeightMm.toFixed(0)} mm`,
      ),
    ),
    // Gcode status row + optional recompile button
    React.createElement(
      'div',
      { style: { ...summaryRowStyle(), flexDirection: 'column' as const, alignItems: 'stretch', gap: 6 } },
      React.createElement(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between' } },
        React.createElement('span', { style: { color: '#9ca3af' } }, 'G-code'),
        React.createElement('span', { style: { color: gcodeColor, fontWeight: 500 } }, gcodeLabel),
      ),
      gcodeStale && onRecompile && React.createElement(
        'button',
        {
          'data-testid': 'workflow-setup-job-recompile',
          type: 'button',
          onClick: onRecompile,
          style: {
            padding: '6px 10px',
            background: '#1a3a5a',
            color: '#90c8ff',
            border: '1px solid #2a5a8a',
            borderRadius: 3,
            fontFamily: FONT,
            fontSize: 11,
            fontWeight: 500,
            cursor: 'pointer',
          },
        },
        'Recompile G-code',
      ),
    ),
    React.createElement(
      'div',
      { style: { fontSize: 11, color: '#6b7280', fontStyle: 'italic' as const, paddingTop: 4 } },
      'Layer overview, start-mode selector, and saved-origin status will land in a Phase-3 follow-up.',
    ),
  );
}
