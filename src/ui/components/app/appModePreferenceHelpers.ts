import type { UserMode } from '../../../app/UserModeGates';

export type UserModeSelectionDecision =
  | { kind: 'noop' }
  | { kind: 'set'; mode: UserMode }
  | { kind: 'confirm-advanced'; mode: Extract<UserMode, 'advanced'> };

export type ProductionModeToggleDecision =
  | { kind: 'set'; enabled: boolean }
  | { kind: 'show-paywall' };

/**
 * T2-6 Phase 3af: pure mode-preference decisions for App callbacks.
 * App.tsx still owns confirm dialogs, navigation, and store setters; this
 * helper owns the branch policy so it can be tested without a browser.
 */
export function resolveUserModeSelection(
  currentMode: UserMode,
  requestedMode: UserMode,
): UserModeSelectionDecision {
  if (requestedMode === currentMode) return { kind: 'noop' };
  if (requestedMode === 'beginner') return { kind: 'set', mode: 'beginner' };
  return { kind: 'confirm-advanced', mode: 'advanced' };
}

export function resolveProductionModeToggle(input: {
  readonly productionMode: boolean;
  readonly proUnlocked: boolean;
}): ProductionModeToggleDecision {
  if (input.productionMode) return { kind: 'set', enabled: false };
  if (!input.proUnlocked) return { kind: 'show-paywall' };
  return { kind: 'set', enabled: true };
}
