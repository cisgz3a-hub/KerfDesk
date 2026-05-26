/**
 * T1-96: Start-button readiness diagnostics panel.
 *
 * Renders structured per-gate status under the Controls Start button.
 * Replaces the single-line `startDisabledReason` string with a
 * collapsible list that names every gate the Start button checks,
 * shows each one's current state, and (when failing) the user-facing
 * action to fix it.
 */
import React, { useState } from 'react';

const font = "'DM Sans', system-ui, sans-serif";

export type GateStatus = 'ok' | 'fail' | 'pending';

export interface StartReadinessGate {
  id:
    | 'gcodeCompiled'
    | 'gcodeFresh'
    | 'preflight'
    | 'machineState'
    | 'frameControls'
    | 'framing'
    | 'currentModeAnchor'
    | 'laserState'
    | 'noActiveOperation'
    | 'noControllerError'
    | 'wcsState'
    | 'connectionTrust'
    | 'controllerConnected';
  label: string;
  status: GateStatus;
  /** One-line headline — shown when a gate is failing. */
  failHeadline?: string;
  /** Human-actionable next step — shown when a gate is failing. */
  failAction?: string;
  /**
   * T1-205: optional clickable recovery action. When present, the
   * panel renders an inline button below the failAction text. The
   * existing failAction string is still shown as a description so
   * the user knows what the button does. Used by the WCS-state
   * gate (and any future gate) when there's a specific recovery
   * command the user can fire from the UI.
   */
  failActionButton?: {
    readonly label: string;
    readonly onClick: () => void;
  };
  /** Optional indented details, currently used by the preflight gate. */
  failDetails?: ReadonlyArray<{ severity: 'blocker' | 'warning'; text: string }>;
}

export interface StartReadiness {
  /** True when the Start button is actually enabled. Mirrors canStartJob. */
  ready: boolean;
  /** The first failing gate, or null when ready. Drives the collapsed summary. */
  blockingGate: StartReadinessGate | null;
  /** All gates, in canonical order. */
  gates: ReadonlyArray<StartReadinessGate>;
}

interface Props {
  readiness: StartReadiness;
}

const COLOR_OK = '#2dd4a0';
const COLOR_FAIL = '#ff8ca0';
const COLOR_PENDING = '#888899';
const COLOR_HEADLINE_BG = 'rgba(255,212,68,0.06)';
const COLOR_HEADLINE_BORDER = 'rgba(255,212,68,0.2)';
const COLOR_HEADLINE_TEXT = '#ffd444';

function statusGlyph(status: GateStatus): string {
  switch (status) {
    case 'ok': return '✓';
    case 'fail': return '✗';
    case 'pending': return '…';
  }
}

function statusColor(status: GateStatus): string {
  switch (status) {
    case 'ok': return COLOR_OK;
    case 'fail': return COLOR_FAIL;
    case 'pending': return COLOR_PENDING;
  }
}

export function StartReadinessPanel({ readiness }: Props): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false);

  // When ready, the green Start button is its own affirmation.
  if (readiness.ready) return null;

  const headline = readiness.blockingGate?.failHeadline
    ?? 'Start is disabled — expand to see why';

  return React.createElement('div', {
    'data-testid': 'start-readiness-panel',
    style: {
      marginTop: 6,
      borderRadius: 6,
      background: COLOR_HEADLINE_BG,
      border: `1px solid ${COLOR_HEADLINE_BORDER}`,
      fontFamily: font,
      overflow: 'hidden',
    },
  },
    React.createElement('button', {
      type: 'button',
      'data-testid': 'start-readiness-toggle',
      onClick: () => setExpanded(v => !v),
      'aria-expanded': expanded,
      style: {
        width: '100%',
        padding: '6px 10px',
        background: 'transparent',
        border: 'none',
        color: COLOR_HEADLINE_TEXT,
        fontSize: 10,
        fontFamily: font,
        textAlign: 'left' as const,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      },
    },
      React.createElement('span', { style: { flexShrink: 0 } }, expanded ? '▼' : '▶'),
      React.createElement('span', { style: { flex: 1 } }, headline),
      React.createElement('span', {
        style: { fontSize: 9, color: '#aa8833', flexShrink: 0 },
      }, expanded ? 'hide details' : 'why?'),
    ),
    expanded && React.createElement('div', {
      'data-testid': 'start-readiness-list',
      style: {
        padding: '6px 10px 10px',
        borderTop: `1px solid ${COLOR_HEADLINE_BORDER}`,
        display: 'flex',
        flexDirection: 'column' as const,
        gap: 4,
      },
    },
      readiness.gates.map(gate => React.createElement('div', {
        key: gate.id,
        'data-testid': `start-readiness-gate-${gate.id}`,
        'data-gate-status': gate.status,
        style: {
          display: 'flex',
          flexDirection: 'column' as const,
          gap: 2,
          padding: '4px 6px',
          background: gate.status === 'fail' ? 'rgba(255,68,102,0.04)' : 'transparent',
          borderRadius: 4,
        },
      },
        React.createElement('div', {
          style: {
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
            fontSize: 10,
          },
        },
          React.createElement('span', {
            style: { color: statusColor(gate.status), fontWeight: 700, width: 10, flexShrink: 0 },
          }, statusGlyph(gate.status)),
          React.createElement('span', {
            style: { color: '#c0c0d0', fontWeight: 500 },
          }, gate.label),
        ),
        gate.status === 'fail' && gate.failHeadline && React.createElement('div', {
          style: { fontSize: 10, color: COLOR_FAIL, paddingLeft: 16, lineHeight: 1.4 },
        }, gate.failHeadline),
        gate.status === 'fail' && gate.failDetails && gate.failDetails.length > 0 &&
          React.createElement('ul', {
            style: {
              margin: '2px 0 0 0',
              padding: '0 0 0 32px',
              fontSize: 9,
              color: '#c0a0a0',
              listStyle: 'disc',
              lineHeight: 1.4,
            },
          },
            gate.failDetails.map((d, i) => React.createElement('li', {
              key: i,
              style: {
                color: d.severity === 'blocker' ? COLOR_FAIL : '#ddc070',
              },
            }, d.text)),
          ),
        gate.status === 'fail' && gate.failAction && React.createElement('div', {
          style: {
            fontSize: 10,
            color: '#90c8ff',
            paddingLeft: 16,
            fontStyle: 'italic' as const,
            lineHeight: 1.4,
          },
        }, `→ ${gate.failAction}`),
        // T1-205: optional clickable recovery action.
        gate.status === 'fail' && gate.failActionButton && React.createElement('button', {
          type: 'button',
          onClick: gate.failActionButton.onClick,
          style: {
            marginTop: 4,
            marginLeft: 16,
            padding: '4px 10px',
            background: '#1a3a5a',
            color: '#90c8ff',
            border: '1px solid #2a5a8a',
            borderRadius: 3,
            fontSize: 11,
            fontWeight: 500,
            cursor: 'pointer',
            alignSelf: 'flex-start' as const,
          },
        }, gate.failActionButton.label),
      )),
    ),
  );
}
