import type { Project } from '../../core/scene';

export function initialProjectWorkspaceState(project: Project) {
  const persistedIds = project.jobSetup.outputScope.selectedObjectIds.filter((id) =>
    project.scene.objects.some((object) => object.id === id),
  );
  const [selectedObjectId, ...additionalSelectedIds] = persistedIds;
  return {
    project,
    projectDocumentEpoch: 0,
    cachedCncMachine: null,
    projectBedReconciliation: null,
    cncLiveCaps: null,
    selectedObjectId: selectedObjectId ?? null,
    selectedPathNode: null,
    selectedPathNodes: [],
    additionalSelectedIds: new Set(additionalSelectedIds),
    previewMode: false,
    externalGcodePreview: null,
    undoStack: [],
    redoStack: [],
    pendingUndo: null,
    cursorMm: null,
    jobPlacement: project.jobSetup.placement,
    outputScopeSettings: {
      cutSelectedGraphics: project.jobSetup.outputScope.cutSelectedGraphics,
      useSelectionOrigin: project.jobSetup.outputScope.useSelectionOrigin,
    },
    registrationArtworkOutputSnapshot: null,
    dirty: false,
    savedName: null,
    lastSaveTarget: null,
    copiedLayerSettings: null,
    sceneClipboard: null,
  };
}
