import React from 'react';

interface ControlsProps {
  canFrame: boolean;
  canStartJob: boolean;
  isSimulator: boolean;
  isRunning: boolean;
  displayPaused: boolean;
  startDisabledReason: string | null;
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
  startDisabledReason,
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
            flex: 2, padding: '12px', fontSize: 14, fontWeight: 700,
            borderRadius: 8, cursor: canStartJob ? 'pointer' : 'default',
            fontFamily: font,
            background: canStartJob ? 'rgba(45,212,160,0.12)' : '#1a1a2e',
            border: canStartJob ? '1px solid #2dd4a0' : '1px solid #252540',
            color: canStartJob ? '#2dd4a0' : '#333355',
          },
        }, `▶ START${isSimulator ? ' (Sim)' : ''}`),
      ),
      startDisabledReason && React.createElement('div', {
        style: {
          fontSize: 10,
          color: '#ffd444',
          textAlign: 'center' as const,
          padding: '4px 8px',
          background: 'rgba(255,212,68,0.06)',
          border: '1px solid rgba(255,212,68,0.2)',
          borderRadius: 6,
          fontFamily: font,
        },
      }, startDisabledReason),
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
