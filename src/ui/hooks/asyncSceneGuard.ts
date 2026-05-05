/**
 * T2-77: async scene-revision guard for long-running scene producers.
 *
 * Pre-T2-77 the trace handler in PropertiesPanel (and importImageUnified
 * in useImport) captured `scene` from React closure at the start of the
 * async work, then awaited the producer for seconds, then committed a
 * `newScene` built from the now-stale captured `scene` — any user
 * edits during the await were silently erased on commit.
 *
 * The fix: capture a revision token (the scene reference itself, since
 * the codebase mutates by replacing the scene object via the immutable
 * pattern) at start of work; after await, check identity against the
 * live scene from a `sceneRef`. If they diverge, the producer refuses
 * to commit and surfaces a "scene changed" message — the user retries.
 *
 * This minimum-viable shape protects against data loss without the
 * conflict-resolution UX (apply-to-current vs discard) that the
 * roadmap describes — that's filed as a T2-77-followup once the dialog
 * pattern is designed. The headline contract — "edits during a trace
 * are not erased on commit" — is delivered.
 *
 * Pure functions, no React. Callers that already have a `sceneRef`
 * (most of `PropertiesPanel`) just inline the calls; testable in
 * isolation.
 */

import type { Scene } from '../../core/scene/Scene';

export interface SceneRevisionToken {
  /** The Scene object reference at capture time. Identity comparison
   *  is sufficient because the codebase mutates by replacing the
   *  scene object (immutable pattern). */
  readonly scene: Scene;
}

export function captureSceneRevision(scene: Scene): SceneRevisionToken {
  return { scene };
}

/**
 * Returns true if the scene has changed identity since capture.
 * Identity is compared, not deep-equality — the codebase's immutable
 * mutation pattern means every committed change produces a new object.
 */
export function isSceneStale(token: SceneRevisionToken, current: Scene): boolean {
  return token.scene !== current;
}
