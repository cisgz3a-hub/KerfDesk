/**
 * T2-55: transactional `resetProjectRuntimeState()`. Pre-T2-55
 * `handleNewProject` at `src/ui/components/App.tsx:1015-1020`
 * cleared scene/history/selection only and missed:
 * `currentGcode`, `lastResult`, `gcodeStale`, `toolpathPreviewMoves`,
 * `showToolpathPreview`, `gcodePreview`, `activeJobMoves`,
 * `activeJobPlanBounds`, `activeJobTransform`, `textPlacementPt`,
 * `toastSuggestion`. Other reset-like flows (recover, template
 * load, profile-switch with machine-changing dimensions) had
 * similar gaps. Values self-corrected through effects (e.g.
 * `gcodeStale` at `useCompileManager.ts:118`) but "eventually"
 * isn't atomic — between click and effects settling, the
 * connection panel showed the previous project's compile state
 * with the new project's scene name.
 *
 * Audit 4A Reset/Cleanup section + Required Fix 6.
 *
 * T2-55 ships the resetter contract + the typed reset-trigger
 * union + the pure orchestrator that fires every resetter in a
 * canonical order. Wiring the App.tsx callers (handleNewProject,
 * handleRecover, handleKeyboardOpen, template load, major profile
 * switch) is filed as T2-55-followup.
 */

/**
 * What kicked off the reset. Used by callers + audit log to tell
 * "user opened a new project" from "auto-recover after crash" from
 * "user switched to a different machine profile".
 */
export type ResetTrigger =
  | 'new-project'
  | 'recover'
  | 'open-file'
  | 'template-load'
  | 'profile-switch-machine-changed'
  | 'profile-switch-cosmetic'
  | 'crash-recovery';

/**
 * The complete set of state slices that a project-runtime reset
 * MUST touch. Audit 4A enumerated 11+ fields that `handleNewProject`
 * was missing; this contract names every owner so a follow-up
 * cannot regress by forgetting one.
 */
export interface ProjectRuntimeResetters {
  resetHistory(): void;
  clearSelection(): void;
  resetCompileState(): void;
  hideToolpathPreview(): void;
  clearActiveJobOverlay(): void;
  clearTextPlacement(): void;
  closeTransientDialogs(): void;
  clearToastSuggestion(): void;
  clearJobSession(): void;
}

/**
 * Canonical reset-step ordering. Pinned by tests so the order
 * doesn't drift across edits — UI seeing partial reset state
 * mid-batch is visible bug surface.
 *
 *   1. clearJobSession  (oldest references first; release jobLog)
 *   2. clearActiveJobOverlay  (canvas no longer renders stale moves)
 *   3. hideToolpathPreview     (preview overlay clears)
 *   4. resetCompileState        (compile state -> 'none')
 *   5. clearTextPlacement       (UI mode reset)
 *   6. clearSelection            (selection now invalid against new scene)
 *   7. resetHistory               (undo stack purge)
 *   8. closeTransientDialogs     (any open dialog over the canvas)
 *   9. clearToastSuggestion       (stale toasts dismissed)
 */
export const RESET_STEP_ORDER = [
  'clearJobSession',
  'clearActiveJobOverlay',
  'hideToolpathPreview',
  'resetCompileState',
  'clearTextPlacement',
  'clearSelection',
  'resetHistory',
  'closeTransientDialogs',
  'clearToastSuggestion',
] as const;

export type ResetStep = typeof RESET_STEP_ORDER[number];

/**
 * Pure orchestrator. Fires every resetter in canonical order,
 * collects errors, returns a typed report. Caller-side React 18+
 * batching means each call is a single re-render — atomic from
 * the user's perspective.
 */
export interface ResetReport {
  readonly trigger: ResetTrigger;
  readonly stepsCompleted: readonly ResetStep[];
  readonly errors: readonly { step: ResetStep; error: Error }[];
}

export function resetProjectRuntimeState(
  trigger: ResetTrigger,
  resetters: ProjectRuntimeResetters,
): ResetReport {
  const completed: ResetStep[] = [];
  const errors: { step: ResetStep; error: Error }[] = [];

  for (const step of RESET_STEP_ORDER) {
    try {
      switch (step) {
        case 'clearJobSession':         resetters.clearJobSession(); break;
        case 'clearActiveJobOverlay':   resetters.clearActiveJobOverlay(); break;
        case 'hideToolpathPreview':     resetters.hideToolpathPreview(); break;
        case 'resetCompileState':       resetters.resetCompileState(); break;
        case 'clearTextPlacement':      resetters.clearTextPlacement(); break;
        case 'clearSelection':          resetters.clearSelection(); break;
        case 'resetHistory':            resetters.resetHistory(); break;
        case 'closeTransientDialogs':   resetters.closeTransientDialogs(); break;
        case 'clearToastSuggestion':    resetters.clearToastSuggestion(); break;
      }
      completed.push(step);
    } catch (e) {
      errors.push({
        step,
        error: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }

  return { trigger, stepsCompleted: completed, errors };
}

/**
 * Predicate for the "profile switch but machine dimensions
 * unchanged" path. Only triggers a full reset when bed dimensions
 * or origin corner changed — cosmetic profile name / icon edits
 * should NOT erase the user's compiled state.
 */
export function profileSwitchTriggersReset(opts: {
  bedWidthChanged: boolean;
  bedHeightChanged: boolean;
  originCornerChanged: boolean;
}): boolean {
  return opts.bedWidthChanged || opts.bedHeightChanged || opts.originCornerChanged;
}

export function describeResetReport(report: ResetReport): string {
  if (report.errors.length === 0) {
    return `Reset (${report.trigger}): ${report.stepsCompleted.length}/${RESET_STEP_ORDER.length} steps OK.`;
  }
  return `Reset (${report.trigger}): ${report.errors.length} step(s) failed (${report.errors.map(e => e.step).join(', ')}).`;
}
