/**
 * T1-204: WorkflowPanel TopBar zone.
 *
 * Always visible at the top of the panel. Three responsibilities:
 *
 *   1. **Status badge** — machine status label + colored pip
 *      (idle/run/hold/alarm/disconnected etc.).
 *   2. **Position readout** — current X/Y in mm with one decimal.
 *      Blank when disconnected.
 *   3. **Emergency Stop button** — small persistent red button,
 *      only visible when connected. The user's design decision
 *      (from the brainstorm) was that E-Stop lives here so it can
 *      never be covered by scrolling, modals, or layout changes.
 *
 * No internal state. All inputs come in via props so the component
 * is trivially renderable in tests and the parent
 * `WorkflowPanel` owns the subscriptions to machineState /
 * machineService.
 */
import React from 'react';
import type { MachineState } from '../../../../controllers/ControllerInterface';
import type { PanelMode } from '../derivePanelMode';
import { panelModeLabel } from '../derivePanelMode';

const FONT = "'DM Sans', system-ui, sans-serif";

const MODE_COLOR: Record<PanelMode, string> = {
  disconnected: '#555',
  connecting: '#a78bfa',
  recovery: '#f87171',
  setup: '#9ca3af',
  ready: '#34d399',
  running: '#60a5fa',
  paused: '#fbbf24',
};

export interface TopBarProps {
  readonly mode: PanelMode;
  readonly machineState: MachineState | null;
  readonly isConnected: boolean;
  readonly onEmergencyStop: () => void;
}

function formatPosition(state: MachineState | null): string {
  if (!state) return '';
  return `X ${state.position.x.toFixed(1)}  Y ${state.position.y.toFixed(1)}`;
}

export function TopBar({
  mode,
  machineState,
  isConnected,
  onEmergencyStop,
}: TopBarProps): React.ReactElement {
  const pipColor = MODE_COLOR[mode];

  return React.createElement(
    'div',
    {
      'data-testid': 'workflow-top-bar',
      style: {
        flexShrink: 0,
        height: 60,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 16px',
        background: '#0d0d18',
        borderBottom: '1px solid #1a1a2e',
        fontFamily: FONT,
        color: '#e5e7eb',
      },
    },
    // Mode pip + label
    React.createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 8 } },
      React.createElement('div', {
        'data-testid': 'workflow-top-bar-pip',
        style: {
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: pipColor,
        },
      }),
      React.createElement(
        'span',
        {
          'data-testid': 'workflow-top-bar-mode-label',
          style: { fontSize: 13, fontWeight: 600, letterSpacing: 0.2 },
        },
        panelModeLabel(mode),
      ),
    ),
    // Position readout (or empty placeholder while disconnected)
    React.createElement(
      'span',
      {
        'data-testid': 'workflow-top-bar-position',
        style: {
          fontSize: 12,
          color: '#9ca3af',
          fontFamily: "'JetBrains Mono', monospace",
          marginLeft: 8,
        },
      },
      formatPosition(machineState),
    ),
    // Spacer
    React.createElement('div', { style: { flex: 1 } }),
    // Emergency Stop — only visible when connected
    isConnected
      ? React.createElement(
          'button',
          {
            'data-testid': 'workflow-top-bar-estop',
            type: 'button',
            onClick: onEmergencyStop,
            style: {
              padding: '6px 14px',
              background: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              fontFamily: FONT,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.6,
              cursor: 'pointer',
              textTransform: 'uppercase',
            },
            'aria-label': 'Emergency Stop',
          },
          'E-STOP',
        )
      : null,
  );
}
