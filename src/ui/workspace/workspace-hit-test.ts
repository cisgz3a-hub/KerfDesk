// What a click on the workspace picks follows what the view shows: Wireframe
// outlines Fill artwork (ADR-410), so its interiors let clicks through as a Line
// shape's do (ADR-683 Amendment 2). The jig editor has no Wireframe, and asks
// the plain hit test.

import { hitTest, type Scene, type Vec2 } from '../../core/scene';
import { hitTestCandidates } from '../../core/scene/hit-test-candidates';
import { useUiStore } from '../state/ui-store';

export function workspaceHitTest(
  scene: Scene,
  point: Vec2,
  options: { readonly includeLocked?: boolean } = {},
): string | null {
  return hitTest(scene, point, { ...options, wireframe: useUiStore.getState().wireframeView });
}

export function workspaceHitTestCandidates(scene: Scene, point: Vec2): ReadonlyArray<string> {
  return hitTestCandidates(scene, point, { wireframe: useUiStore.getState().wireframeView });
}
