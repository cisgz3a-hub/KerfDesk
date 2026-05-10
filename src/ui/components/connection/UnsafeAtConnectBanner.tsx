/**
 * T3-91 (T1-25 follow-up): inline banner rendered in the connection
 * panel header when the controller's connect-time safe-state verdict
 * is non-null. Pre-T3-91 the verdict was only surfaced through the
 * start-job preflight dialog — a user clicking Frame or Jog before
 * Start would see refusal with no visible reason.
 *
 * Render shape: a yellow-warning banner with reason headline + detail
 * + recovery action button. The mapping from reason to message lives
 * in `unsafeAtConnectMessages.ts` so both this banner and the
 * preflight blocker render the same text.
 *
 * The banner consults `controllerRef.current?.getUnsafeAtConnect()`
 * through the supplied `unsafeVerdict` prop. When that prop is `null`,
 * the banner unmounts (no DOM). When the user presses the recovery
 * action, the parent's `onRecoveryAction` handler decides what to do
 * (reset / reconnect / send M5 — see `UnsafeAtConnectMessage.actionKind`).
 *
 * Dismiss: a "I've inspected manually" link hides the banner without
 * changing controller state. The underlying preflight blocker still
 * fires until reconnect captures a clean verdict — the dismiss is a
 * UI-only acknowledgment, not a state change.
 */

import { useState, type ReactElement } from 'react';
import type { UnsafeAtConnectState } from '../../../controllers/grbl/GrblController';
import {
  describeUnsafeAtConnect,
  type UnsafeAtConnectActionKind,
} from './unsafeAtConnectMessages';

export interface UnsafeAtConnectBannerProps {
  /** Latest verdict from `controllerRef.current?.getUnsafeAtConnect()`. */
  readonly unsafeVerdict: UnsafeAtConnectState | null;
  /** Called when the user presses the recovery action button. */
  readonly onRecoveryAction: (kind: UnsafeAtConnectActionKind) => void;
}

export function UnsafeAtConnectBanner(props: UnsafeAtConnectBannerProps): ReactElement | null {
  const [dismissed, setDismissed] = useState(false);
  const verdict = props.unsafeVerdict;

  // Reset the dismissed flag when the verdict transitions back to null
  // (post-recovery reconnect) — a future non-null verdict shows the
  // banner again. Track the verdict reason so we know when it changes.
  const reasonKey = verdict?.reason ?? null;

  if (verdict === null) {
    if (dismissed) {
      // Reset for next time. useState updater outside render is fine
      // here because reasonKey === null is a terminal branch.
      Promise.resolve().then(() => setDismissed(false));
    }
    return null;
  }
  if (dismissed) return null;

  const message = describeUnsafeAtConnect(verdict.reason);

  return (
    <div
      role="status"
      aria-live="polite"
      className="unsafe-at-connect-banner"
      data-test-id="unsafe-at-connect-banner"
      data-reason={verdict.reason}
      style={{
        // Inline-style fallback. The repo also uses CSS classes; the
        // class name above hooks any global stylesheet without
        // requiring a new CSS import here.
        backgroundColor: '#fff8d6',
        borderLeft: '4px solid #d4a72c',
        padding: '8px 12px',
        margin: '8px 0',
        fontSize: '0.92em',
      }}
    >
      <div style={{ fontWeight: 600 }}>{message.headline}</div>
      <div style={{ marginTop: 4 }}>{message.detail}</div>
      <div style={{ marginTop: 6, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          type="button"
          onClick={(): void => props.onRecoveryAction(message.actionKind)}
          data-test-id="unsafe-at-connect-action"
        >
          {message.actionLabel}
        </button>
        <button
          type="button"
          onClick={(): void => setDismissed(true)}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#555',
            cursor: 'pointer',
            textDecoration: 'underline',
            fontSize: 'inherit',
          }}
          data-test-id="unsafe-at-connect-dismiss"
        >
          I&rsquo;ve inspected manually
        </button>
      </div>
      {reasonKey !== null && (
        <div
          aria-hidden="true"
          data-reason-key={reasonKey}
          style={{ display: 'none' }}
        />
      )}
    </div>
  );
}
