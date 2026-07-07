import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';

export function useWorkspaceDragDeps() {
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const selectObject = useStore((s) => s.selectObject);
  const selectObjects = useStore((s) => s.selectObjects);
  const selectPathNode = useStore((s) => s.selectPathNode);
  const setSelectedPathNodePositionDuringInteraction = useStore(
    (s) => s.setSelectedPathNodePositionDuringInteraction,
  );
  const toggleSelectObject = useStore((s) => s.toggleSelectObject);
  const setCursorMm = useStore((s) => s.setCursorMm);
  const beginInteraction = useStore((s) => s.beginInteraction);
  const setObjectTransform = useStore((s) => s.setObjectTransform);
  const endInteraction = useStore((s) => s.endInteraction);
  const cancelInteraction = useStore((s) => s.cancelInteraction);
  const drawShape = useStore((s) => s.drawShape);
  const toolMode = useUiStore((s) => s.toolMode);
  const selectionAnchor = useUiStore((s) => s.selectionAnchor);
  const snapSettings = useUiStore((s) => s.snapSettings);
  const setSnapGuides = useUiStore((s) => s.setSnapGuides);
  const setDraftShape = useUiStore((s) => s.setDraftShape);
  const setMeasureDraft = useUiStore((s) => s.setMeasureDraft);
  const setSelectionMarquee = useUiStore((s) => s.setSelectionMarquee);
  return {
    selectedObjectId,
    additionalSelectedIds,
    selectObject,
    selectObjects,
    selectPathNode,
    setSelectedPathNodePositionDuringInteraction,
    toggleSelectObject,
    setCursorMm,
    beginInteraction,
    setObjectTransform,
    endInteraction,
    cancelInteraction,
    drawShape,
    toolMode,
    selectionAnchor,
    snapSettings,
    setSnapGuides,
    setDraftShape,
    setMeasureDraft,
    setSelectionMarquee,
  };
}
