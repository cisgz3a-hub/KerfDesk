import { useCallback, useEffect } from 'react';
import { computeObjectBounds } from '../../geometry/bounds';
import { type Scene } from '../../core/scene/Scene';
import { type SceneObject } from '../../core/scene/SceneObject';
import { isBoxStudioPath } from '../stores/appDialogsStore';
import { useGeneratorHandlers } from './useGeneratorHandlers';

interface UseAppGeneratorWorkflowsParams {
  readonly scene: Scene;
  readonly selectedIds: ReadonlySet<string>;
  readonly setSelectedIds: (ids: Set<string>) => void;
  readonly handleSceneCommit: (scene: Scene) => void;
  readonly setShowGridArray: (value: boolean) => void;
  readonly setGridArrayBounds: (bounds: { w: number; h: number }) => void;
  readonly setShowTemplates: (updater: boolean | ((value: boolean) => boolean)) => void;
  readonly showAlert: (title: string, message: string) => Promise<void>;
  readonly setShowBoxStudio: (value: boolean) => void;
}

export function computeGridArraySourceBounds(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
): { w: number; h: number } | null {
  if (selectedIds.size === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const obj of scene.objects) {
    if (!selectedIds.has(obj.id)) continue;
    const b = computeObjectBounds(obj);
    if (!b) continue;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }

  if (!isFinite(minX)) return null;
  return { w: maxX - minX, h: maxY - minY };
}

export function useAppGeneratorWorkflows({
  scene,
  selectedIds,
  setSelectedIds,
  handleSceneCommit,
  setShowGridArray,
  setGridArrayBounds,
  setShowTemplates,
  showAlert,
  setShowBoxStudio,
}: UseAppGeneratorWorkflowsParams) {
  const handleGridArray = useCallback(() => {
    const bounds = computeGridArraySourceBounds(scene, selectedIds);
    if (!bounds) return;
    setGridArrayBounds(bounds);
    setShowGridArray(true);
  }, [scene, selectedIds, setGridArrayBounds, setShowGridArray]);

  const {
    handleGridArrayConfirm,
    handleNestingApply,
    handleBoxGenerate,
    handleVariableTextGenerate,
    handleTemplateSelect,
  } = useGeneratorHandlers({
    scene,
    selectedIds,
    setSelectedIds: ids => setSelectedIds(new Set(ids)),
    handleSceneCommit,
    setShowGridArray,
    setShowTemplates,
    showAlert,
  });

  useEffect(() => {
    const handlePopState = () => {
      setShowBoxStudio(isBoxStudioPath(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [setShowBoxStudio]);

  const openBoxStudio = useCallback(() => {
    setShowBoxStudio(true);
    if (window.location.pathname !== '/box-studio') {
      window.history.pushState({}, '', '/box-studio');
    }
  }, [setShowBoxStudio]);

  const closeBoxStudio = useCallback(() => {
    setShowBoxStudio(false);
    if (isBoxStudioPath(window.location.pathname)) {
      window.history.pushState({}, '', '/');
    }
  }, [setShowBoxStudio]);

  const handleBoxStudioGenerate = useCallback((objects: SceneObject[]) => {
    handleBoxGenerate(objects);
    closeBoxStudio();
  }, [closeBoxStudio, handleBoxGenerate]);

  return {
    handleGridArray,
    handleGridArrayConfirm,
    handleNestingApply,
    handleBoxGenerate,
    handleVariableTextGenerate,
    handleTemplateSelect,
    openBoxStudio,
    closeBoxStudio,
    handleBoxStudioGenerate,
  };
}
