/**
 * T1-206 (Phase 2): real `connecting` mode for `WorkflowPanel`.
 *
 * Renders during the controller handshake — between the user
 * clicking "Connect USB" and the controller responding with its
 * welcome line. The cancel button lives in the
 * `PrimaryActionFooter` (per the design: footer is the home for
 * the contextual action) so this mode is intentionally minimal: a
 * spinner, a status line, and a hint about the cancel button.
 *
 * No props except for nudging hints — the cancel callback is wired
 * into the footer at the panel level. Keeping this component pure
 * (no state, no callbacks) means the user can't accidentally
 * trigger anything from here.
 */
import React from 'react';

const FONT = "'DM Sans', system-ui, sans-serif";

// Inline CSS for the spinner animation — keeps the mode self-
// contained without touching a global stylesheet. The keyframes
// are scoped to a unique class name so they can't collide with
// any other panel.
const SPINNER_CSS = `
@keyframes workflow-connecting-spin {
  to { transform: rotate(360deg); }
}
.workflow-connecting-spinner {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 3px solid rgba(167, 139, 250, 0.25);
  border-top-color: #a78bfa;
  animation: workflow-connecting-spin 0.9s linear infinite;
}
`;

export function ConnectingMode(): React.ReactElement {
  return React.createElement(
    'div',
    {
      'data-testid': 'workflow-connecting-mode',
      style: {
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: 24,
        fontFamily: FONT,
      },
    },
    React.createElement('style', null, SPINNER_CSS),
    React.createElement('div', { className: 'workflow-connecting-spinner' }),
    React.createElement(
      'div',
      { style: { fontSize: 14, color: '#e5e7eb', fontWeight: 500 } },
      'Connecting…',
    ),
    React.createElement(
      'div',
      { style: { fontSize: 11, color: '#9ca3af', textAlign: 'center' as const, maxWidth: 320, lineHeight: 1.5 } },
      'Waiting for the controller welcome line. If this hangs longer than ten seconds, click Cancel below and check the cable / power.',
    ),
  );
}
