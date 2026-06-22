import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';

export function useWorkspaceDragDeps() {
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const selectObject = useStore((s) => s.selectObject);
  const selectObjects = useStore((s) => s.selectObjects);
  const toggleSelectObject = useStore((s) => s.toggleSelectObject);
  const setCursorMm = useStore((s) => s.setCursorMm);
  const beginInteraction = useStore((s) => s.beginInteraction);
  const setObjectTransform = useStore((s) => s.setObjectTransform);
  const endInteraction = useStore((s) => s.endInteraction);
  const drawShape = useStore((s) => s.drawShape);
  const toolMode = useUiStore((s) => s.toolMode);
  const selectionAnchor = useUiStore((s) => s.selectionAnchor);
  const snapSettings = useUiStore((s) => s.snapSettings);
  const setSnapGuides = useUiStore((s) => s.setSnapGuides);
  const setDraftShape = useUiStore((s) => s.setDraftShape);
  const setSelectionMarquee = useUiStore((s) => s.setSelectionMarquee);
  return {
    selectedObjectId,
    selectObject,
    selectObjects,
    toggleSelectObject,
    setCursorMm,
    beginInteraction,
    setObjectTransform,
    endInteraction,
    drawShape,
    toolMode,
    selectionAnchor,
    snapSettings,
    setSnapGuides,
    setDraftShape,
    setSelectionMarquee,
  };
}
