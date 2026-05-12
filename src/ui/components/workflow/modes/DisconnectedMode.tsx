/**
 * T1-206 (Phase 2): real `disconnected` mode for `WorkflowPanel`.
 *
 * Embeds the existing `ConnectWizard` component inside the mode-
 * content zone. The wizard already handles browser-compatibility
 * detection (WebSerial / non-WebSerial), the USB + Simulator
 * choice, and the disabled-during-connect race guard.
 *
 * The primary action footer also shows a "Connect USB" button
 * (mode-aware default), so on this mode the user has two entry
 * points: the rich choice cards in the body and the always-
 * visible footer button. Both fire the same `onConnectUsb`
 * callback; intentional redundancy because the footer is always
 * visible per the design and shouldn't be confusing.
 */
import React from 'react';
import { ConnectWizard } from '../../connection/ConnectWizard';

export interface DisconnectedModeProps {
  readonly webSerialSupported: boolean;
  readonly onConnectUsb: () => void;
  readonly onConnectSimulator: () => void;
}

export function DisconnectedMode({
  webSerialSupported,
  onConnectUsb,
  onConnectSimulator,
}: DisconnectedModeProps): React.ReactElement {
  return React.createElement(
    'div',
    {
      'data-testid': 'workflow-disconnected-mode',
      style: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto' as const,
        display: 'flex',
        flexDirection: 'column' as const,
      },
    },
    React.createElement(ConnectWizard, {
      webSerialSupported,
      onConnectUsb,
      onConnectSimulator,
    }),
  );
}
