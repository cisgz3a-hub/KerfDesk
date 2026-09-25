import type { Project, RasterImage, TraceSettingsRecord } from '../../core/scene';
import type { AppThemePreference } from '../theme/app-theme';
import type { GcodeInspectionSource } from '../gcode-inspector';
import type { SelectedImageMaskPair } from './image-mask-command-state';

export type CommandShellCallbacks = {
  readonly requestImportImage: () => void;
  readonly requestMultiFileTrace: () => void;
  readonly requestConvertToBitmap: () => void;
  readonly requestAdjustImage: () => void;
  /** Open the ADR-255 G-code Inspector without forcing a file read on the UI thread. */
  readonly requestGcodeInspector: (programName: string, source: GcodeInspectionSource) => void;
  readonly requestBoxGenerator: () => void;
  readonly requestBarcodeGenerator: () => void;
  readonly requestBoxFitTest: () => void;
  readonly requestMaterialTest: () => void;
  readonly requestIntervalTest: () => void;
  readonly requestScanOffsetTest: () => void;
  readonly requestFocusTest: () => void;
  readonly requestOptimizationSettings: () => void;
  readonly requestArray: () => void;
  readonly requestQuickNest: () => void;
  readonly requestUnionSilhouette: () => void;
  readonly requestJoinPaths: () => void;
  readonly requestPrintAndCut: () => void;
  readonly requestRotarySetup: () => void;
  readonly requestLabsSettings: () => void;
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
    options?: {
      readonly replaceTraceId?: string;
      readonly traceSettings?: TraceSettingsRecord;
    },
  ) => void;
  readonly textTool: () => void;
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
  readonly toggleSidePanels: () => void;
  readonly resetWorkspaceLayout: () => void;
  readonly appTheme: AppThemePreference;
  readonly setAppTheme: (preference: AppThemePreference) => void;
  readonly printAndCutFeatureEnabled: boolean;
  readonly printAndCutProfileSupported: boolean;
  readonly printAndCut: () => void;
};

export type CommandSelection = {
  readonly selected: Project['scene']['objects'][number] | null;
  readonly selectedIds: ReadonlyArray<string>;
  readonly imageMaskPair: SelectedImageMaskPair | null;
};
