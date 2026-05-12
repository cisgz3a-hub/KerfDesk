/**
 * T1-207 (Phase 3): Move tab in the setup mode.
 *
 * Phase 3 ships the jog pad via the existing `Jog` component. Frame
 * / test-fire controls are scheduled for a Phase 3 follow-up — they
 * need active-operation gating + frame-anchor invalidation that
 * lives deeper in ConnectionPanelMain. For now Move covers the
 * core jog + home + go-to-last-position + auto-focus surface,
 * which is what users reach for most when setting up a job.
 *
 * The existing Jog component is reused 1:1 so the safety surface
 * (gates passed in via `canHome`, `canFocus`, `focusBusy`) matches
 * the legacy panel exactly.
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
    // Phase 3 follow-up: frame buttons + test fire will land here.
    // For now we surface a small note so users know what's coming.
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
      'Frame and test-fire controls will land in a Phase-3 follow-up. Disable the workflowPanelV2 flag and use the legacy panel for those actions.',
    ),
  );
}
