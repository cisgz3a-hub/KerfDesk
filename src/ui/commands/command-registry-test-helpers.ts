import { vi } from 'vitest';
import type { AppCommandContext } from './command-registry';

// The dirty-project guard resolves through a promise chain
// (confirmDiscard(...).then(...)); two hops cover mock-promise unwrap +
// the .then callback.
export async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

export function baseCtx(overrides: Partial<AppCommandContext> = {}): AppCommandContext {
  return {
    ...baseCtxFlags(),
    ...baseCtxActions(),
    ...baseCtxArrangeActions(),
    ...overrides,
  } as AppCommandContext;
}

function baseCtxFlags(): Partial<AppCommandContext> {
  return {
    machineKind: 'laser',
    dirty: false,
    savedName: null,
    serialSupported: true,
    connected: false,
    machineBusy: false,
    homingEnabled: true,
    canUndo: false,
    canRedo: false,
    hasSelection: false,
    hasRasterSelection: false,
    canRetraceOriginal: false,
    hasConvertibleSelection: false,
    canConvertSelectionToPath: false,
    canWeldSelection: false,
    canCombineSelection: false,
    hasFillableSelection: false,
    canCloseOpenFillContours: false,
    canReviewCloseOpenFillContours: false,
    canApplyImageMask: false,
    hasMaskedRasterSelection: false,
    canPaste: false,
    canGroupSelection: false,
    canUngroupSelection: false,
    canLockSelection: false,
    hasLockedObjects: false,
    measureActive: false,
    focusTestAvailable: false,
    canTransformSelection: false,
    canAlignSelection: false,
    canDistributeSelection: false,
    canBreakApartSelection: false,
    previewActive: false,
    hasPreviewableContent: true,
  };
}

function baseCtxActions(): Partial<AppCommandContext> {
  return {
    confirmDiscard: vi.fn(async () => true),
    newProject: vi.fn(),
    openProject: vi.fn(),
    saveProject: vi.fn(),
    saveProjectAs: vi.fn(),
    importSvg: vi.fn(),
    importDxf: vi.fn(),
    importImage: vi.fn(),
    openGcodePreview: vi.fn(),
    multiFileTrace: vi.fn(),
    saveGcode: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    selectAll: vi.fn(),
    copySelection: vi.fn(),
    cutSelection: vi.fn(),
    pasteClipboard: vi.fn(),
    groupSelection: vi.fn(),
    ungroupSelection: vi.fn(),
    lockSelection: vi.fn(),
    unlockAllObjects: vi.fn(),
    duplicateSelection: vi.fn(),
    deleteSelection: vi.fn(),
    clearSelection: vi.fn(),
    measureTool: vi.fn(),
    addText: vi.fn(),
    registrationPanelOpen: false,
    toggleRegistrationPanel: vi.fn(),
    cameraPanelOpen: false,
    toggleCameraPanel: vi.fn(),
    boxGenerator: vi.fn(),
    boxFitTest: vi.fn(),
    materialTest: vi.fn(),
    intervalTest: vi.fn(),
    scanOffsetTest: vi.fn(),
    focusTest: vi.fn(),
    optimizationSettings: vi.fn(),
    adjustImage: vi.fn(),
    saveProcessedBitmap: vi.fn(),
    traceImage: vi.fn(),
    retraceOriginal: vi.fn(),
    convertSelectionToPath: vi.fn(),
    weldSelection: vi.fn(),
    subtractSelection: vi.fn(),
    intersectSelection: vi.fn(),
    excludeSelection: vi.fn(),
    convertToBitmap: vi.fn(),
    fillSelectionSeparately: vi.fn(),
    closeSelectedOpenFillContours: vi.fn(),
    reviewCloseOpenFillContours: vi.fn(),
    applyImageMask: vi.fn(),
    cropImage: vi.fn(),
    removeImageMask: vi.fn(),
    connectLaser: vi.fn(),
    disconnectLaser: vi.fn(),
    homeLaser: vi.fn(),
    togglePreview: vi.fn(),
    resetView: vi.fn(),
    projectNotes: vi.fn(),
    undoHistory: vi.fn(),
    showAbout: vi.fn(),
    showConnectionHelp: vi.fn(),
    showSafety: vi.fn(),
  };
}

function baseCtxArrangeActions(): Partial<AppCommandContext> {
  return {
    alignSelection: vi.fn(),
    distributeSelection: vi.fn(),
    breakApartSelection: vi.fn(),
    flipHorizontal: vi.fn(),
    flipVertical: vi.fn(),
  };
}
