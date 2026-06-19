import { describe, expect, it, vi } from 'vitest';
import {
  buildAppCommands,
  commandById,
  runCommand,
  type AppCommandContext,
} from './command-registry';

function baseCtx(overrides: Partial<AppCommandContext> = {}): AppCommandContext {
  return {
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
    hasConvertibleSelection: false,
    canApplyImageMask: false,
    hasMaskedRasterSelection: false,
    canPaste: false,
    confirmDiscard: vi.fn(async () => true),
    newProject: vi.fn(),
    openProject: vi.fn(),
    saveProject: vi.fn(),
    saveProjectAs: vi.fn(),
    importSvg: vi.fn(),
    importImage: vi.fn(),
    multiFileTrace: vi.fn(),
    saveGcode: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    selectAll: vi.fn(),
    copySelection: vi.fn(),
    cutSelection: vi.fn(),
    pasteClipboard: vi.fn(),
    duplicateSelection: vi.fn(),
    deleteSelection: vi.fn(),
    clearSelection: vi.fn(),
    addText: vi.fn(),
    materialTest: vi.fn(),
    intervalTest: vi.fn(),
    scanOffsetTest: vi.fn(),
    focusTestAvailable: false,
    focusTest: vi.fn(),
    optimizationSettings: vi.fn(),
    adjustImage: vi.fn(),
    saveProcessedBitmap: vi.fn(),
    traceImage: vi.fn(),
    convertToBitmap: vi.fn(),
    applyImageMask: vi.fn(),
    removeImageMask: vi.fn(),
    cropImage: vi.fn(),
    connectLaser: vi.fn(),
    disconnectLaser: vi.fn(),
    homeLaser: vi.fn(),
    togglePreview: vi.fn(),
    previewActive: false,
    hasPreviewableContent: true,
    resetView: vi.fn(),
    showAbout: vi.fn(),
    canTransformSelection: false,
    canAlignSelection: false,
    alignSelection: vi.fn(),
    canDistributeSelection: false,
    distributeSelection: vi.fn(),
    flipHorizontal: vi.fn(),
    flipVertical: vi.fn(),
    ...overrides,
  };
}

describe('image mask commands', () => {
  it('enables Apply Mask to Image only when one image and one closed mask are selected', () => {
    const applyImageMask = vi.fn();
    const disabled = buildAppCommands(baseCtx({ applyImageMask }));

    expect(commandById(disabled, 'tools.apply-image-mask').enabled).toBe(false);
    expect(runCommand(commandById(disabled, 'tools.apply-image-mask'))).toBe(false);

    const enabled = buildAppCommands(baseCtx({ canApplyImageMask: true, applyImageMask }));
    expect(commandById(enabled, 'tools.apply-image-mask').enabled).toBe(true);
    expect(runCommand(commandById(enabled, 'tools.apply-image-mask'))).toBe(true);
    expect(applyImageMask).toHaveBeenCalledTimes(1);
  });

  it('enables Remove Image Mask only when the selected image has a mask', () => {
    const removeImageMask = vi.fn();
    const disabled = buildAppCommands(baseCtx({ hasRasterSelection: true, removeImageMask }));

    expect(commandById(disabled, 'tools.remove-image-mask').enabled).toBe(false);
    expect(runCommand(commandById(disabled, 'tools.remove-image-mask'))).toBe(false);

    const enabled = buildAppCommands(
      baseCtx({ hasRasterSelection: true, hasMaskedRasterSelection: true, removeImageMask }),
    );
    expect(commandById(enabled, 'tools.remove-image-mask').enabled).toBe(true);
    expect(runCommand(commandById(enabled, 'tools.remove-image-mask'))).toBe(true);
    expect(removeImageMask).toHaveBeenCalledTimes(1);
  });

  it('enables Crop Image only when the selected image has a mask to bake', () => {
    const cropImage = vi.fn();
    const disabled = buildAppCommands(baseCtx({ hasRasterSelection: true, cropImage }));

    expect(commandById(disabled, 'tools.crop-image').enabled).toBe(false);
    expect(runCommand(commandById(disabled, 'tools.crop-image'))).toBe(false);

    const enabled = buildAppCommands(
      baseCtx({ hasRasterSelection: true, hasMaskedRasterSelection: true, cropImage }),
    );
    expect(commandById(enabled, 'tools.crop-image').enabled).toBe(true);
    expect(runCommand(commandById(enabled, 'tools.crop-image'))).toBe(true);
    expect(cropImage).toHaveBeenCalledTimes(1);
  });
});
