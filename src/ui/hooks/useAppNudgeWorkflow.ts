import { useCallback, useRef } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type SceneCommitAction } from '../scene/SceneCommitActions';

interface UseAppNudgeWorkflowParams {
  readonly scene: Scene;
  readonly selectedIds: ReadonlySet<string>;
  readonly handleSceneChange: (scene: Scene) => void;
  readonly handleSceneCommit: (scene: Scene, action?: SceneCommitAction) => void;
}

export function useAppNudgeWorkflow({
  scene,
  selectedIds,
  handleSceneChange,
  handleSceneCommit,
}: UseAppNudgeWorkflowParams) {
  const isNudgingRef = useRef(false);
  const nudgeSceneRef = useRef<Scene | null>(null);

  const handleNudge = useCallback((dx: number, dy: number, commit: boolean) => {
    if (commit) {
      if (isNudgingRef.current && nudgeSceneRef.current) {
        handleSceneCommit(nudgeSceneRef.current, 'nudge');
        isNudgingRef.current = false;
        nudgeSceneRef.current = null;
      }
      return;
    }
    if (selectedIds.size === 0) return;
    const baseScene = nudgeSceneRef.current || scene;
    const newScene = {
      ...baseScene,
      objects: baseScene.objects.map(o =>
        selectedIds.has(o.id)
          ? { ...o, transform: { ...o.transform, tx: o.transform.tx + dx, ty: o.transform.ty + dy } }
          : o
      ),
    };
    handleSceneChange(newScene);
    nudgeSceneRef.current = newScene;
    isNudgingRef.current = true;
  }, [scene, selectedIds, handleSceneChange, handleSceneCommit]);

  return { handleNudge };
}
