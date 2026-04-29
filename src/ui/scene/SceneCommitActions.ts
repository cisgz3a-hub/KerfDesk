/**
 * Action labels for scene-edit transactions, threaded through
 * handleSceneCommit and ultimately into commitSceneTransaction's
 * reason field (`{ kind: 'edit', action }`).
 *
 * The unified function in SceneTransaction.ts takes `action: string`
 * (open-ended). This union narrows the callers' surface so:
 *
 *   - Typos are caught at compile time.
 *   - The (currently no-op) transitionLog has a closed, documented
 *     set of edit categories. T3-68 will render distinguishable
 *     log entries for "paste" vs "layer color edit" vs "image
 *     import" without inventing a taxonomy at log-emit time.
 *   - Adding a new category is one type change, one call-site update,
 *     and zero changes to the dispatch function.
 *
 * Always keep `'unspecified'` in the union. App.tsx's internal
 * commit callers (and the mixed-bag hooks not yet migrated) still
 * default to it; gradual migration is intentional.
 *
 * When adding a new action, prefer a kebab-case noun describing
 * WHAT changed about the scene, not HOW the user triggered the
 * change. ('paste' is a what; 'paste-from-keyboard' is a how.)
 */
export type SceneCommitAction =
  | 'unspecified'
  | 'paste'
  | 'duplicate'
  | 'layer-mode'
  | 'layer-setting'
  | 'layer-fill-setting'
  | 'layer-kerf'
  | 'nesting'
  | 'box-generate'
  | 'var-text-generate'
  | 'template-import'
  | 'array-clone'
  | 'image-import'
  | 'svg-import'
  | 'dxf-import'
  // App.tsx internal callers (added in the App.tsx-label-cleanup commit
  // following T2-12 part 2). These cover the ~10 sites that previously
  // defaulted to 'unspecified'. A handful are atomic-pattern migrations
  // (text-add, mode-select) that pass selectionAfter as the third arg
  // to handleSceneCommit; the rest just supply an honest action label.
  | 'text-edit'
  | 'text-add'
  | 'mode-select'
  | 'start-position'
  | 'camera-position'
  | 'calibration-grid'
  | 'nudge'
  | 'material-clear'
  | 'learned-toast-apply'
  // Mixed-bag hooks migration commit 2. Atomic-pattern migrations
  // pass selectionAfter as the 3rd arg to handleSceneCommit; the
  // selection-preserving transforms just supply a label.
  | 'move-to-layer'
  | 'align'
  | 'distribute'
  | 'rotate'
  | 'flip'
  | 'move-to-corner'
  | 'move-to-material-origin'
  | 'toggle-lock'
  | 'toggle-visibility'
  | 'offset'
  | 'boolean-op'
  | 'text-to-path';
