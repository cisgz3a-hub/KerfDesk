import React, { useState, useEffect, useCallback } from 'react';
import { type LaserController } from '../../controllers/ControllerInterface';

/**
 * LaserModeBanner: surfaces a warning when the connected machine
 * has $32=0 (standard CNC mode, the GRBL default for non-laser
 * machines). In this mode, M3/M4 commands often don't fire the
 * cutting laser as expected — Frame and Test Fire produce silent
 * failures or weak yellow-LED-only output instead of a real cut.
 *
 * Why this exists: $32=0 is the recurring blocker that earlier
 * sessions kept hitting. Test Fire would do nothing on a fresh
 * connection unless the user manually primed the machine via
 * Frame+Mark Center first. The proper fix is $32=1 on the
 * machine. Until users know to set this, they hit the wall over
 * and over. This banner detects the condition and offers one-
 * click remediation.
 *
 * Behavior:
 *   - Shows when isConnected && isOperational && the controller
 *     reports laserMode=false.
 *   - Hides when laserMode=true, when not yet connected/operational,
 *     or once dismissed for the session.
 *   - "Enable laser mode" button: confirms, then sends $32=1 via
 *     the service-owned user command sender. The optimistic local snapshot flips
 *     to 'on' on success so the banner hides immediately. (The
 *     controller's $32 parse path doesn't currently fire a state
 *     listener, so without the optimistic flip the banner would
 *     stay until the next reconnect.)
 *   - "Dismiss" button: hides the banner for the rest of this
 *     session without changing the machine.
 *
 * Snapshot semantics (Option B from the design discussion):
 *   - On connect (isOperational becomes true), read laserMode once
 *     and freeze that snapshot.
 *   - On disconnect, reset the snapshot and dismiss flag so the
 *     next connect re-evaluates fresh.
 *   - Don't try to live-react to $32 changes mid-session. If the
 *     user sets $32=1 from the console panel, the optimistic flip
 *     handles the common case where they're sitting on the
 *     banner. Other paths (e.g. user runs $$ and we see it in the
 *     dump) are out of scope; reconnect picks them up.
 */

interface LaserModeBannerProps {
  controller: LaserController | null;
  /** True after settings handshake completes (machineState.status is idle/alarm/run/hold). */
  isOperational: boolean;
  /** Confirmation dialog from useModal. Returns true if user confirms. */
  showConfirm: (title: string, message: string, details?: string) => Promise<boolean>;
  /** Service-owned user command sender; handles approval-token policy. */
  sendUserCommand: (cmd: string) => void | Promise<void>;
  /** Optional logging hook to surface success/failure into the message log. */
  appendMessage?: (msg: string) => void;
}

type LaserModeSnapshot = 'unknown' | 'on' | 'off';

export function LaserModeBanner({
  controller,
  isOperational,
  showConfirm,
  sendUserCommand,
  appendMessage,
}: LaserModeBannerProps) {
  const [snapshot, setSnapshot] = useState<LaserModeSnapshot>('unknown');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isOperational) {
      setSnapshot('unknown');
      setDismissed(false);
      return;
    }
    if (!controller) return;
    const info = (controller as unknown as {
      getMachineInfo?: () => { laserMode?: boolean };
    }).getMachineInfo?.();
    if (info && typeof info.laserMode === 'boolean') {
      setSnapshot(info.laserMode ? 'on' : 'off');
    }
  }, [isOperational, controller]);

  const handleEnable = useCallback(async () => {
    if (!controller) return;
    const ok = await showConfirm(
      'Enable laser mode?',
      'This will send $32=1 to the machine, switching it from standard CNC mode to laser mode. ' +
        'Laser mode is required for M3/M4 commands to fire the cutting laser. ' +
        'The setting is persistent — you only need to do this once per machine.',
    );
    if (!ok) return;
    try {
      await sendUserCommand('$32=1');
      setSnapshot('on');
      appendMessage?.('Laser mode enabled ($32=1 sent).');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendMessage?.(`Failed to enable laser mode: ${msg}`);
    }
  }, [controller, showConfirm, sendUserCommand, appendMessage]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  if (!isOperational || snapshot !== 'off' || dismissed) return null;

  const font = "'DM Sans', system-ui, sans-serif";

  return React.createElement(
    'div',
    {
      style: {
        margin: '10px 16px 0',
        padding: '12px 14px',
        background: 'rgba(255,170,0,0.08)',
        border: '1px solid rgba(255,170,0,0.4)',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
      },
    },
    React.createElement('div', { style: { fontSize: 20, flexShrink: 0 } }, '⚠'),
    React.createElement(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      React.createElement(
        'div',
        { style: { fontSize: 12, fontWeight: 600, color: '#ffaa00', marginBottom: 2 } },
        'Machine in standard CNC mode ($32=0)',
      ),
      React.createElement(
        'div',
        { style: { fontSize: 10, color: '#ffd080', lineHeight: 1.4 } },
        'Frame and Test Fire may not fire the cutting laser. Click Enable to switch to laser mode (sends $32=1).',
      ),
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        onClick: () => {
          void handleEnable();
        },
        style: {
          padding: '8px 14px',
          fontSize: 12,
          fontWeight: 700,
          borderRadius: 6,
          cursor: 'pointer',
          fontFamily: font,
          background: '#ffaa00',
          border: '1px solid #ffaa00',
          color: '#000',
          flexShrink: 0,
          whiteSpace: 'nowrap' as const,
        },
      },
      'Enable laser mode',
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        onClick: handleDismiss,
        title: 'Dismiss for this session',
        style: {
          padding: '8px 10px',
          fontSize: 12,
          fontWeight: 600,
          borderRadius: 6,
          cursor: 'pointer',
          fontFamily: font,
          background: 'transparent',
          border: '1px solid rgba(255,170,0,0.4)',
          color: '#ffaa00',
          flexShrink: 0,
        },
      },
      'Dismiss',
    ),
  );
}
