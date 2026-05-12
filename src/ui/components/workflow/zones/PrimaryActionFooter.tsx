/**
 * T1-204: WorkflowPanel PrimaryActionFooter zone.
 *
 * Always visible at the bottom of the panel. One contextual primary
 * button that changes label / action by mode, plus zero or more
 * secondary buttons. The user's design decision from the brainstorm:
 * a single context-aware primary so the user always knows what the
 * next action is, regardless of mode.
 *
 * Mode → primary mapping (Phase 1 stub — real handlers wired Phase 2+):
 *
 *   disconnected → "Connect USB"
 *   connecting   → "Cancel" (secondary; primary disabled w/ spinner)
 *   recovery     → "Acknowledge" (forwarded by RecoveryMode in Phase 2)
 *   setup        → context-blocker label (e.g. "Frame before start")
 *                  or disabled "Not ready"
 *   ready        → "Start Job"  (largest button; green)
 *   running      → "Pause" + Stop (secondary)
 *   paused       → "Resume" + Stop (secondary)
 *
 * In Phase 1 the buttons render and are clickable; the click handlers
 * are provided by the parent. Phase 2 wires them to MachineService /
 * ExecutionCoordinator.
 */
import React from 'react';
import type { PanelMode } from '../derivePanelMode';

const FONT = "'DM Sans', system-ui, sans-serif";

export interface PrimaryActionDescriptor {
  readonly label: string;
  readonly variant: 'primary' | 'success' | 'danger' | 'disabled';
  readonly onClick: (() => void) | null;
}

export interface SecondaryActionDescriptor {
  readonly label: string;
  readonly onClick: (() => void) | null;
}

export interface PrimaryActionFooterProps {
  readonly mode: PanelMode;
  readonly primary: PrimaryActionDescriptor;
  readonly secondaries: ReadonlyArray<SecondaryActionDescriptor>;
}

function backgroundFor(variant: PrimaryActionDescriptor['variant']): string {
  switch (variant) {
    case 'primary':  return '#3b82f6';
    case 'success':  return '#10b981';
    case 'danger':   return '#dc2626';
    case 'disabled': return '#374151';
  }
}

export function PrimaryActionFooter({
  mode,
  primary,
  secondaries,
}: PrimaryActionFooterProps): React.ReactElement {
  return React.createElement(
    'div',
    {
      'data-testid': 'workflow-primary-action-footer',
      'data-mode': mode,
      style: {
        flexShrink: 0,
        minHeight: 72,
        padding: '12px 16px',
        background: '#0d0d18',
        borderTop: '1px solid #1a1a2e',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: FONT,
      },
    },
    // Primary button — fills the available width
    React.createElement(
      'button',
      {
        'data-testid': 'workflow-primary-action',
        'data-variant': primary.variant,
        type: 'button',
        onClick: primary.onClick ?? undefined,
        disabled: primary.variant === 'disabled' || primary.onClick === null,
        style: {
          flex: 1,
          padding: '10px 16px',
          background: backgroundFor(primary.variant),
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          fontFamily: FONT,
          fontSize: 14,
          fontWeight: 600,
          cursor: primary.variant === 'disabled' ? 'not-allowed' : 'pointer',
          opacity: primary.variant === 'disabled' ? 0.6 : 1,
        },
      },
      primary.label,
    ),
    // Secondary buttons (e.g. Stop next to Pause/Resume)
    ...secondaries.map((secondary, i) =>
      React.createElement(
        'button',
        {
          'data-testid': `workflow-secondary-action-${i}`,
          key: `secondary-${i}`,
          type: 'button',
          onClick: secondary.onClick ?? undefined,
          disabled: secondary.onClick === null,
          style: {
            padding: '10px 14px',
            background: '#1f2937',
            color: '#e5e7eb',
            border: '1px solid #374151',
            borderRadius: 6,
            fontFamily: FONT,
            fontSize: 13,
            cursor: secondary.onClick === null ? 'not-allowed' : 'pointer',
          },
        },
        secondary.label,
      ),
    ),
  );
}
