import React from 'react';
import { ConsoleInput } from './ConsoleInput';
import { type LaserController } from '../../controllers/ControllerInterface';
import { buildSafeGrblDiagnosticsRequest } from '../../diagnostics/GrblDiagnostics';

interface ConsolePanelProps {
  isConnected: boolean;
  isRunning: boolean;
  controller: LaserController | null;
  sendUserCommand: (cmd: string) => void | Promise<void>;
  advancedSection: React.ReactNode;
  simulatorView: React.ReactNode;
}

export function ConsolePanel({
  isConnected,
  isRunning,
  controller,
  sendUserCommand,
  advancedSection,
  simulatorView,
}: ConsolePanelProps) {
  const [diagnosticsCopyState, setDiagnosticsCopyState] = React.useState<string | null>(null);

  const copySafeGrblDiagnostics = async (): Promise<void> => {
    const request = buildSafeGrblDiagnosticsRequest();
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(request);
      setDiagnosticsCopyState('Copied read-only GRBL diagnostics commands.');
    } catch {
      setDiagnosticsCopyState(request);
    }
  };

  if (!isConnected) return null;
  return React.createElement(
    'section',
    {
      'data-testid': 'connection-advanced-details-body',
      style: {
        minHeight: 0,
        flexShrink: 0,
      },
    },
    advancedSection,
    React.createElement('div', {
      style: {
        margin: '10px 0',
        padding: 10,
        borderRadius: 6,
        border: '1px solid rgba(0,212,255,0.2)',
        background: 'rgba(0,212,255,0.04)',
      },
    },
      React.createElement('button', {
        type: 'button',
        onClick: () => { void copySafeGrblDiagnostics(); },
        style: {
          width: '100%',
          padding: '8px 10px',
          borderRadius: 6,
          border: '1px solid rgba(0,212,255,0.35)',
          background: 'rgba(0,212,255,0.08)',
          color: '#00d4ff',
          cursor: 'pointer',
          fontWeight: 700,
        },
      }, 'Safe GRBL diagnostics'),
      React.createElement('div', {
        style: {
          marginTop: 6,
          fontSize: 10,
          lineHeight: 1.45,
          color: '#8888aa',
          whiteSpace: 'pre-wrap' as const,
        },
      },
        diagnosticsCopyState
          ?? 'Copies read-only GRBL identity, settings, modal-state, work-offset, and live-status requests for support. It never sends a homing command.',
      ),
    ),
    simulatorView,
    React.createElement(ConsoleInput, { controller, isConnected, isRunning, sendUserCommand }),
  );
}
