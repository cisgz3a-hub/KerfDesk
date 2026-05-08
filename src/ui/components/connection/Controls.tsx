import React from 'react';
import { StartReadinessPanel, type StartReadiness } from './StartReadinessPanel';

interface ControlsProps {
  canFrame: boolean;
  canStartJob: boolean;
  isSimulator: boolean;
  isRunning: boolean;
  displayPaused: boolean;
  startButtonLabel?: string;
  /**
   * T1-96: structured readiness state replaces the single-string
   * `startDisabledReason`. The panel renders nothing when
   * `readiness.ready === true`, otherwise shows a collapsible per-gate
   * list with details and actions.
   */
  startReadiness: StartReadiness;
  onFrame: () => void;
  onStartJob: () => void;
  onPauseResume: () => void;
  onStop: () => void;
}

const font = "'DM Sans', system-ui, sans-serif";

export function Controls({
  canFrame,
  canStartJob,
  isSimulator,
  isRunning,
  displayPaused,
  startButtonLabel,
  startReadiness,
  onFrame,
  onStartJob,
  onPauseResume,
  onStop,
}: ControlsProps) {
  return React.createElement('div', {
    style: {
      padding: '10px 16px',
      borderTop: '1px solid #1a1a2e',
      background: '#0d0d18',
      flexShrink: 0,
    },
  },
    React.createElement('div', {
      style: {
        fontSize: 10,
        color: '#777798',
        marginBottom: 7,
        textTransform: 'uppercase' as const,
        letterSpacing: 0,
        fontWeight: 700,
      },
    }, 'Run Job'),
    !isRunning && !displayPaused && React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
    },
      React.createElement('div', {
        style: { display: 'flex', gap: 6 },
      },
        React.createElement('button', {
          type: 'button',
          'data-testid': 'connection-frame',
          onClick: () => { onFrame(); },
          disabled: !canFrame,
          style: {
            flex: 1, padding: '12px', fontSize: 12, fontWeight: 600,
            borderRadius: 8, cursor: canFrame ? 'pointer' : 'default',
            fontFamily: font,
            background: '#0a0a14', border: '1px solid #252540', color: '#c0c0d0',
            opacity: canFrame ? 1 : 0.4,
          },
        }, '⬚ Frame'),
        React.createElement('button', {
          type: 'button',
          'data-testid': 'connection-start-job',
          onClick: () => { onStartJob(); },
          disabled: !canStartJob,
          style: {
            // T1-110: disabled-state contrast bumped so the button
            // remains visibly distinguishable from the sidebar bg
            // (#1a1a2e). Pre-T1-110 disabled was #333355 on #1a1a2e
            // — the button blended into the panel and users read
            // it as "no Start button" instead of "Start disabled."
            flex: 2, padding: '12px', fontSize: 14, fontWeight: 700,
            borderRadius: 8, cursor: canStartJob ? 'pointer' : 'default',
            fontFamily: font,
            background: canStartJob ? 'rgba(45,212,160,0.12)' : '#1a1a2e',
            border: canStartJob ? '1px solid #2dd4a0' : '1px solid #3a3a55',
            color: canStartJob ? '#2dd4a0' : '#8888a0',
          },
        }, startButtonLabel ?? `▶ START${isSimulator ? ' (Sim)' : ''}`),
      ),
      React.createElement(StartReadinessPanel, { readiness: startReadiness }),
    ),
    (isRunning || displayPaused) && React.createElement('div', {
      style: { display: 'flex', gap: 6 },
    },
      React.createElement('button', {
        type: 'button',
        onClick: () => { onPauseResume(); },
        style: {
          flex: 1, padding: '14px', fontSize: 13, fontWeight: 700,
          borderRadius: 8, cursor: 'pointer', fontFamily: font,
          background: displayPaused ? 'rgba(45,212,160,0.1)' : 'rgba(255,212,68,0.08)',
          border: displayPaused ? '2px solid #2dd4a0' : '2px solid rgba(255,212,68,0.4)',
          color: displayPaused ? '#2dd4a0' : '#ffd444',
        },
      }, displayPaused ? '▶ Resume' : '⏸ Pause'),
      React.createElement('button', {
        type: 'button',
        onClick: () => { onStop(); },
        style: {
          flex: 1, padding: '14px', fontSize: 13, fontWeight: 700,
          borderRadius: 8, cursor: 'pointer', fontFamily: font,
          background: 'rgba(255,68,102,0.08)',
          border: '2px solid rgba(255,68,102,0.4)',
          color: '#ff4466',
        },
      }, '⏹ Stop'),
    ),
  );
}
