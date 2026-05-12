/**
 * T1-204: shared stub renderer for mode placeholders during Phase 1.
 *
 * Each mode in `WorkflowPanel` will eventually be a real component
 * (Phases 2–4). Phase 1 ships the scaffold + routing only — every
 * mode renders a `ModeStub` saying "Phase N will fill this in" so
 * the routing is testable end-to-end with the flag on without
 * needing any real implementation.
 *
 * When a mode's real implementation lands, this stub is replaced at
 * the import site in `WorkflowPanel.tsx`. The file stays for any
 * future mode that is added as a stub before being implemented.
 */
import React from 'react';
import type { PanelMode } from '../derivePanelMode';
import { panelModeLabel } from '../derivePanelMode';

const FONT = "'DM Sans', system-ui, sans-serif";

export interface ModeStubProps {
  readonly mode: PanelMode;
  readonly phase: number;
}

export function ModeStub({ mode, phase }: ModeStubProps): React.ReactElement {
  return React.createElement(
    'div',
    {
      'data-testid': 'workflow-mode-stub',
      'data-mode': mode,
      style: {
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 24,
        fontFamily: FONT,
        color: '#9ca3af',
      },
    },
    React.createElement(
      'div',
      { style: { fontSize: 18, fontWeight: 600, color: '#e5e7eb' } },
      `${panelModeLabel(mode)} mode`,
    ),
    React.createElement(
      'div',
      { style: { fontSize: 13, color: '#6b7280' } },
      `Phase ${phase} will fill this in.`,
    ),
  );
}
