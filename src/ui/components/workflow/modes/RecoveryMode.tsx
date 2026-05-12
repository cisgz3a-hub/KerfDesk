/**
 * T1-206 (Phase 2): real `recovery` mode for `WorkflowPanel`.
 *
 * Renders the existing `RecoveryCard` with content derived from
 * the current `RecoveryState` + `MachineStatus`. Hard lock per the
 * user's design decision — when this mode is active, no other tab
 * or content is reachable. The footer's primary button is
 * disabled; the only way out is the action buttons on the card
 * itself (Unlock / Re-home / Reconnect / etc.).
 *
 * Action wiring: the `onAction` callback is forwarded from the
 * panel, which fans out to the appropriate MachineService /
 * ExecutionCoordinator method in the adapter. Phase 2 wires the
 * critical paths (Unlock for alarm clear, Reconnect for disconnect
 * recovery); the rest can be filled in as Phase 3+ lands or stay
 * as no-ops without breaking the read-only safety surface.
 */
import React from 'react';
import type { MachineStatus } from '../../../../controllers/ControllerInterface';
import type { RecoveryState } from '../../../../runtime/RecoveryState';
import type { RecoveryAction } from '../../../recovery/RecoveryCardContent';
import { buildRecoveryCard } from '../../../recovery/RecoveryCardContent';
import { RecoveryCard } from '../../../recovery/RecoveryCard';
import { recoveryVariantFromState } from '../recoveryVariantFromState';

export interface RecoveryModeProps {
  readonly recoveryState: RecoveryState;
  readonly machineStatus: MachineStatus | null;
  readonly alarmCode: number | null;
  readonly onRecoveryAction: ((action: RecoveryAction) => void) | null;
}

export function RecoveryMode({
  recoveryState,
  machineStatus,
  alarmCode,
  onRecoveryAction,
}: RecoveryModeProps): React.ReactElement {
  const variantInfo = recoveryVariantFromState({
    recoveryState,
    machineStatus,
    alarmCode,
  });
  const content = buildRecoveryCard({
    variant: variantInfo.variant,
    alarmCode: variantInfo.alarmCode,
    frameTimeoutSec: variantInfo.frameTimeoutSec ?? undefined,
    errorMessage: variantInfo.errorMessage ?? undefined,
  });
  return React.createElement(
    'div',
    {
      'data-testid': 'workflow-recovery-mode',
      'data-variant': variantInfo.variant,
      style: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto' as const,
        display: 'flex',
        flexDirection: 'column' as const,
      },
    },
    React.createElement(RecoveryCard, {
      content,
      onAction: onRecoveryAction ?? undefined,
    }),
  );
}
