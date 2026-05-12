/**
 * T1-207 (Phase 3) + T1-211 (Phase 5b): Move tab in the setup mode.
 *
 * Reuses the existing `Jog` component 1:1 for the jog pad / home /
 * last-position / auto-focus surface so the safety surface stays
 * shared with the legacy panel. T1-211 adds Frame + Frame-Dot
 * buttons below the jog pad, wired through to the adapter.
 *
 * Test-fire is still deferred — it needs deadman-timer plumbing
 * that lives in the legacy panel's local state.
 */
import React from 'react';
import { Jog } from '../../../connection/Jog';

const FONT = "'DM Sans', system-ui, sans-serif";

export interface MoveTabProps {
  readonly jogStep: number;
  readonly setJogStep: (step: number) => void;
  readonly onJog: (axis: 'X' | 'Y', distance: number) => void;
  readonly onHome: () => void;
  readonly canHome: boolean;
  readonly canGoToLastPosition?: boolean;
  readonly lastPositionLabel?: string;
  readonly onGoToLastPosition?: () => void;
  readonly showFocus?: boolean;
  readonly canFocus?: boolean;
  readonly focusBusy?: boolean;
  readonly onFocus?: () => void;
  // T1-211: frame buttons. canFrame is the gate (idle + compiled
  // job + valid bounds); null callbacks render the buttons disabled.
  readonly canFrame: boolean;
  readonly onFrameSafe: (() => void) | null;
  readonly onFrameDot: (() => void) | null;
}

function frameBtnStyle(enabled: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: '10px 12px',
    background: enabled ? '#1a3a5a' : '#1f1f33',
    color: enabled ? '#90c8ff' : '#6b7280',
    border: `1px solid ${enabled ? '#2a5a8a' : '#252540'}`,
    borderRadius: 6,
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: 500,
    cursor: enabled ? 'pointer' : 'not-allowed',
  };
}

export function MoveTab(props: MoveTabProps): React.ReactElement {
  return React.createElement(
    'div',
    {
      'data-testid': 'workflow-setup-move-tab',
      style: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto' as const,
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column' as const,
        gap: 12,
        fontFamily: FONT,
      },
    },
    React.createElement(Jog, {
      jogStep: props.jogStep,
      setJogStep: props.setJogStep,
      onJog: props.onJog,
      onHome: props.onHome,
      canHome: props.canHome,
      canGoToLastPosition: props.canGoToLastPosition,
      lastPositionLabel: props.lastPositionLabel,
      onGoToLastPosition: props.onGoToLastPosition,
      showFocus: props.showFocus,
      canFocus: props.canFocus,
      focusBusy: props.focusBusy,
      onFocus: props.onFocus,
    }),
    // T1-211: Frame controls. Two buttons side by side — Frame
    // (safe corner trace, laser off) and Frame + Dot (low-power
    // outline + center mark). Disabled until canFrame is true
    // (idle controller + compiled job).
    React.createElement(
      'div',
      {
        'data-testid': 'workflow-move-frame-buttons',
        style: { display: 'flex', gap: 8 },
      },
      React.createElement(
        'button',
        {
          'data-testid': 'workflow-move-frame-safe',
          type: 'button',
          disabled: !props.canFrame || props.onFrameSafe === null,
          onClick: props.onFrameSafe ?? undefined,
          style: frameBtnStyle(props.canFrame && props.onFrameSafe !== null),
        },
        'Frame',
      ),
      React.createElement(
        'button',
        {
          'data-testid': 'workflow-move-frame-dot',
          type: 'button',
          disabled: !props.canFrame || props.onFrameDot === null,
          onClick: props.onFrameDot ?? undefined,
          style: frameBtnStyle(props.canFrame && props.onFrameDot !== null),
        },
        'Frame + Dot',
      ),
    ),
    !props.canFrame && React.createElement(
      'div',
      {
        style: {
          fontSize: 11,
          color: '#6b7280',
          fontStyle: 'italic' as const,
          paddingTop: 2,
        },
      },
      'Frame is available once the machine is idle and a job is compiled.',
    ),
    React.createElement(
      'div',
      {
        style: {
          fontSize: 11,
          color: '#6b7280',
          fontStyle: 'italic' as const,
          paddingTop: 4,
        },
      },
      'Test-fire is still in the legacy panel — flip the flag off if you need it.',
    ),
  );
}
