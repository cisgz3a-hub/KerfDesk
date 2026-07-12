import type { Project, RasterImage } from '../../core/scene';
import type { SelectedImageMaskPair } from './image-mask-command-state';

export type CommandShellCallbacks = {
  readonly requestImportImage: () => void;
  readonly requestMultiFileTrace: () => void;
  readonly requestConvertToBitmap: () => void;
  readonly requestAdjustImage: () => void;
  readonly requestBoxGenerator: () => void;
  readonly requestBoxFitTest: () => void;
  readonly requestMaterialTest: () => void;
  readonly requestIntervalTest: () => void;
  readonly requestScanOffsetTest: () => void;
  readonly requestFocusTest: () => void;
  readonly requestOptimizationSettings: () => void;
  readonly requestProjectNotes: () => void;
  readonly requestUndoHistory: () => void;
  readonly requestCloseOpenFillContoursWithTolerance: () => void;
  readonly showAbout: () => void;
  readonly showConnectionHelp: () => void;
  readonly showSafety: () => void;
};

export type CommandDialogs = {
  readonly openImageDialog: (
    source: RasterImage,
    options?: { readonly replaceTraceId?: string },
  ) => void;
  readonly openTextDialog: (options: { readonly mode: 'add' }) => void;
  readonly measureTool: () => void;
  readonly measureActive: boolean;
  readonly registrationPanelOpen: boolean;
  readonly toggleRegistrationPanel: () => void;
  readonly boardCapturePanelOpen: boolean;
  readonly toggleBoardCapturePanel: () => void;
  readonly cameraPanelOpen: boolean;
  readonly toggleCameraPanel: () => void;
  readonly layersPanelOpen: boolean;
  readonly toggleLayersPanel: () => void;
  readonly machinePanelOpen: boolean;
  readonly toggleMachinePanel: () => void;
};

export type CommandSelection = {
  readonly selected: Project['scene']['objects'][number] | null;
  readonly selectedIds: ReadonlyArray<string>;
  readonly imageMaskPair: SelectedImageMaskPair | null;
};
