// tool-command-context — the Tools-family slice of AppCommandContext
// (generators, calibration, trace, image, and vector-path actions). Split
// from use-app-commands.ts to keep that file inside the size cap.

import type { usePlatform } from '../app/platform-context';
import { handleSaveProcessedBitmap } from '../app/save-processed-bitmap';
import type { useStore } from '../state';
import type { useToastStore } from '../state/toast-store';
import type {
  CommandDialogs,
  CommandSelection,
  CommandShellCallbacks,
} from './app-command-context-types';
import type { AppCommandContext } from './command-types';
import { openBooleanDialog } from './boolean-dialog-store';
import {
  applyImageMaskAction,
  cropImageAction,
  removeImageMaskAction,
  retraceOriginalAction,
  traceImageAction,
} from './image-command-actions';

type ToolCommandContext = Pick<
  AppCommandContext,
  | 'boxGenerator'
  | 'barcodeGenerator'
  | 'boxFitTest'
  | 'materialTest'
  | 'intervalTest'
  | 'scanOffsetTest'
  | 'focusTest'
  | 'optimizationSettings'
  | 'rotarySetup'
  | 'labsSettings'
  | 'adjustImage'
  | 'saveProcessedBitmap'
  | 'traceImage'
  | 'retraceOriginal'
  | 'multiFileTrace'
  | 'convertSelectionToPath'
  | 'weldSelection'
  | 'unionSilhouette'
  | 'joinPaths'
  | 'resizeJoints'
  | 'prepareStamp'
  | 'subtractSelection'
  | 'intersectSelection'
  | 'excludeSelection'
  | 'convertToBitmap'
  | 'fillSelectionSeparately'
  | 'closeSelectedOpenFillContours'
  | 'reviewCloseOpenFillContours'
  | 'applyImageMask'
  | 'cropImage'
  | 'removeImageMask'
>;

export function toolCommandContext(
  callbacks: CommandShellCallbacks,
  app: ReturnType<typeof useStore.getState>,
  platform: ReturnType<typeof usePlatform>,
  dialogs: CommandDialogs,
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
  selection: CommandSelection,
): ToolCommandContext {
  return {
    boxGenerator: callbacks.requestBoxGenerator,
    barcodeGenerator: callbacks.requestBarcodeGenerator,
    boxFitTest: callbacks.requestBoxFitTest,
    materialTest: callbacks.requestMaterialTest,
    intervalTest: callbacks.requestIntervalTest,
    scanOffsetTest: callbacks.requestScanOffsetTest,
    focusTest: callbacks.requestFocusTest,
    optimizationSettings: callbacks.requestOptimizationSettings,
    rotarySetup: callbacks.requestRotarySetup,
    labsSettings: callbacks.requestLabsSettings,
    adjustImage: callbacks.requestAdjustImage,
    saveProcessedBitmap: saveProcessedBitmapAction(platform, app, pushToast),
    traceImage: traceImageAction(selection.selected, dialogs.openImageDialog),
    retraceOriginal: retraceOriginalAction(
      app.project,
      selection.selected,
      dialogs.openImageDialog,
      pushToast,
    ),
    multiFileTrace: callbacks.requestMultiFileTrace,
    convertSelectionToPath: app.convertSelectionToPath,
    weldSelection: () => openBooleanDialog('weld'),
    unionSilhouette: callbacks.requestUnionSilhouette,
    joinPaths: callbacks.requestJoinPaths,
    ...(callbacks.requestResizeJoints === undefined
      ? {}
      : { resizeJoints: callbacks.requestResizeJoints }),
    ...(callbacks.requestPrepareStamp === undefined
      ? {}
      : { prepareStamp: callbacks.requestPrepareStamp }),
    subtractSelection: () => openBooleanDialog('subtract'),
    intersectSelection: () => openBooleanDialog('intersect'),
    excludeSelection: () => openBooleanDialog('exclude'),
    convertToBitmap: callbacks.requestConvertToBitmap,
    fillSelectionSeparately: app.fillSelectionSeparately,
    closeSelectedOpenFillContours: app.closeSelectedOpenFillContours,
    reviewCloseOpenFillContours: callbacks.requestCloseOpenFillContoursWithTolerance,
    applyImageMask: applyImageMaskAction(app, selection.imageMaskPair),
    cropImage: cropImageAction(app, selection.selected, pushToast),
    removeImageMask: removeImageMaskAction(app, selection.selected),
  };
}

function saveProcessedBitmapAction(
  platform: ReturnType<typeof usePlatform>,
  app: ReturnType<typeof useStore.getState>,
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
): () => void {
  return () =>
    void handleSaveProcessedBitmap({
      platform,
      project: app.project,
      selectedObjectId: app.selectedObjectId,
      pushToast,
    });
}
