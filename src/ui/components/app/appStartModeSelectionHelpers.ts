import type { Scene } from '../../../core/scene/Scene';
import type { GcodeStartMode } from '../../../core/output/GcodeOrigin';
import type { SceneCommitAction } from '../../scene/SceneCommitActions';

export interface StartModeSelectionCommit {
  scene: Scene;
  action: Extract<SceneCommitAction, 'start-position'>;
  shouldResetWcs: boolean;
}

export interface StartModeStatusLabelInput {
  mode: GcodeStartMode;
  savedOrigin: { readonly x: number; readonly y: number } | null | undefined;
}

/**
 * T2-6 Phase 3ad: pure start-mode selection transaction builder.
 * App.tsx still owns persisted start-mode state and the controller WCS
 * command; this helper owns the rounded start-position scene update and
 * the saved-origin exception policy.
 */
export function buildStartModeSelectionCommit(
  scene: Scene,
  mode: GcodeStartMode,
  origin: { readonly x: number; readonly y: number },
): StartModeSelectionCommit {
  return {
    scene: {
      ...scene,
      startPosition: { x: Math.round(origin.x), y: Math.round(origin.y) },
    },
    action: 'start-position',
    shouldResetWcs: mode === 'absolute',
  };
}

/**
 * T2-6 Phase 3am: pure start-mode status-label formatting.
 * App.tsx still owns rendering and saved-origin state.
 */
export function resolveStartModeStatusLabel(input: StartModeStatusLabelInput): string {
  if (input.mode === 'absolute') return 'Canvas = Bed position';
  if (input.mode === 'current') return 'Design starts at laser head';
  if (input.savedOrigin) {
    return `Design starts at saved origin X:${input.savedOrigin.x.toFixed(0)} Y:${input.savedOrigin.y.toFixed(0)}`;
  }
  return 'No saved origin - set one below';
}
