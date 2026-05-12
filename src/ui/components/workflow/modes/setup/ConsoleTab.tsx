/**
 * T1-207 (Phase 3): Console tab in the setup mode.
 *
 * Reuses the existing `ConsolePanel` — manual command input,
 * structured message log, and the diagnostics-copy shortcut.
 * `advancedSection` and `simulatorView` (the two slot-ins the
 * legacy panel renders inside the console) are intentionally
 * passed as `null` in Phase 3 — they'll come in a follow-up
 * when the simulator-mode flag plumbing is threaded through.
 */
import React from 'react';
import { ConsolePanel } from '../../../ConsolePanel';
import type { LaserController } from '../../../../../controllers/ControllerInterface';
import type { StructuredLogEvent } from '../../../../../app/StructuredMessageLog';

export interface ConsoleTabProps {
  readonly isConnected: boolean;
  readonly isRunning: boolean;
  readonly controller: LaserController | null;
  readonly sendUserCommand: (cmd: string) => void | Promise<void>;
  readonly messageEvents: readonly StructuredLogEvent[];
}

export function ConsoleTab({
  isConnected,
  isRunning,
  controller,
  sendUserCommand,
  messageEvents,
}: ConsoleTabProps): React.ReactElement {
  return React.createElement(
    'div',
    {
      'data-testid': 'workflow-setup-console-tab',
      style: {
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column' as const,
      },
    },
    React.createElement(ConsolePanel, {
      isConnected,
      isRunning,
      controller,
      sendUserCommand,
      advancedSection: null,
      simulatorView: null,
      messageEvents,
    }),
  );
}
