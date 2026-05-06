import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { type CalibrationGridResult } from '../../core/materials/CalibrationGrid';
import { type MaterialSuggestion } from '../../core/materials/MaterialFeedback';
import { type Move } from '../../core/plan/Plan';
import { type SceneObject, type TextGeometry } from '../../core/scene/SceneObject';
import { type SettingsTab } from '../components/SettingsModal';

export type { SettingsTab };

export type BooleanSetterValue = boolean | ((current: boolean) => boolean);
export type CanvasPoint = { x: number; y: number };
export type ToastSuggestionState = { suggestion: MaterialSuggestion; materialName: string };

// T2-6: first Zustand boundary for App.tsx UI shell state. Keep this store
// limited to dialogs, transient prompts, and small modal handoff payloads.
export interface AppDialogsState {
  settingsOpen: boolean;
  settingsInitialTab: SettingsTab;
  showTextDialog: boolean;
  editingTextId: string | null;
  textInput: string;
  textFont: string;
  textSize: number;
  textBold: boolean;
  textItalic: boolean;
  showMaterialTest: boolean;
  showCalibrateMaterial: boolean;
  showMaterialLibrary: boolean;
  materialLibraryRevision: number;
  showCamera: boolean;
  lastCalibrationGridResult: CalibrationGridResult | null;
  showKerfWizard: boolean;
  showFontCredits: boolean;
  showBoxGenerator: boolean;
  showGridArray: boolean;
  gridArrayBounds: { w: number; h: number };
  showNesting: boolean;
  showToolpathPreview: boolean;
  toolpathPreviewMoves: readonly Move[] | null;
  gcodePreview: string | null;
  isDragOver: boolean;
  textPlacementHint: string | null;
  textPlacementPt: CanvasPoint | null;
  textPreviewFontReady: boolean;
  showVariableText: boolean;
  variableTextSource: SceneObject | null;
  showConnection: boolean;
  showToolpath: boolean;
  showShortcuts: boolean;
  showTemplates: boolean;
  showMaterial: boolean;
  showSetup: boolean;
  showRecover: boolean;
  recoverAutosaveTimeLabel: string | null;
  toastSuggestion: ToastSuggestionState | null;
  showFeedback: boolean;
  showBoxStudio: boolean;
}

export interface AppDialogsActions {
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setShowTextDialog: (show: BooleanSetterValue) => void;
  setEditingTextId: (id: string | null) => void;
  setTextInput: (text: string) => void;
  setTextFont: (font: string) => void;
  setTextSize: (size: number) => void;
  setTextBold: (bold: BooleanSetterValue) => void;
  setTextItalic: (italic: BooleanSetterValue) => void;
  openTextEdit: (obj: SceneObject) => void;
  closeTextDialog: () => void;
  setShowMaterialTest: (show: BooleanSetterValue) => void;
  setShowCalibrateMaterial: (show: BooleanSetterValue) => void;
  setShowMaterialLibrary: (show: BooleanSetterValue) => void;
  bumpMaterialLibraryRevision: () => void;
  setShowCamera: (show: BooleanSetterValue) => void;
  setLastCalibrationGridResult: (result: CalibrationGridResult | null) => void;
  setShowKerfWizard: (show: BooleanSetterValue) => void;
  setShowFontCredits: (show: BooleanSetterValue) => void;
  setShowBoxGenerator: (show: BooleanSetterValue) => void;
  setShowGridArray: (show: BooleanSetterValue) => void;
  setGridArrayBounds: (bounds: { w: number; h: number }) => void;
  setShowNesting: (show: BooleanSetterValue) => void;
  setShowToolpathPreview: (show: BooleanSetterValue) => void;
  setToolpathPreviewMoves: (moves: readonly Move[] | null) => void;
  clearToolpathPreview: () => void;
  setGcodePreview: (gcode: string | null) => void;
  setIsDragOver: (show: BooleanSetterValue) => void;
  setTextPlacementHint: (hint: string | null) => void;
  setTextPlacementPt: (point: CanvasPoint | null) => void;
  setTextPreviewFontReady: (ready: boolean) => void;
  setShowVariableText: (show: BooleanSetterValue) => void;
  setVariableTextSource: (source: SceneObject | null) => void;
  setShowConnection: (show: BooleanSetterValue) => void;
  setShowToolpath: (show: BooleanSetterValue) => void;
  setShowShortcuts: (show: BooleanSetterValue) => void;
  setShowTemplates: (show: BooleanSetterValue) => void;
  setShowMaterial: (show: BooleanSetterValue) => void;
  setShowSetup: (show: BooleanSetterValue) => void;
  setShowRecover: (show: BooleanSetterValue) => void;
  setRecoverAutosaveTimeLabel: (label: string | null) => void;
  setToastSuggestion: (suggestion: ToastSuggestionState | null) => void;
  setShowFeedback: (show: BooleanSetterValue) => void;
  setShowBoxStudio: (show: BooleanSetterValue) => void;
  resetDialogs: () => void;
}

export type AppDialogsStore = AppDialogsState & AppDialogsActions;

export const appDialogsInitialState: AppDialogsState = {
  settingsOpen: false,
  settingsInitialTab: 'machine',
  showTextDialog: false,
  editingTextId: null,
  textInput: '',
  textFont: 'Arial',
  textSize: 20,
  textBold: false,
  textItalic: false,
  showMaterialTest: false,
  showCalibrateMaterial: false,
  showMaterialLibrary: false,
  materialLibraryRevision: 0,
  showCamera: false,
  lastCalibrationGridResult: null,
  showKerfWizard: false,
  showFontCredits: false,
  showBoxGenerator: false,
  showGridArray: false,
  gridArrayBounds: { w: 0, h: 0 },
  showNesting: false,
  showToolpathPreview: false,
  toolpathPreviewMoves: null,
  gcodePreview: null,
  isDragOver: false,
  textPlacementHint: null,
  textPlacementPt: null,
  textPreviewFontReady: true,
  showVariableText: false,
  variableTextSource: null,
  showConnection: false,
  showToolpath: false,
  showShortcuts: false,
  showTemplates: false,
  showMaterial: false,
  showSetup: false,
  showRecover: false,
  recoverAutosaveTimeLabel: null,
  toastSuggestion: null,
  showFeedback: false,
  showBoxStudio: false,
};

export interface CreateAppDialogsStoreOptions {
  readonly initialShowSetup?: boolean;
  readonly initialShowBoxStudio?: boolean;
}

export function getSetupStorageKey(): string {
  try {
    if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
      return 'laserforge_setup_complete_electron';
    }
  } catch {
    /* ignore */
  }
  return 'laserforge_setup_complete';
}

export function shouldShowSetupByDefault(): boolean {
  try {
    return !localStorage.getItem(getSetupStorageKey());
  } catch {
    return true;
  }
}

export function isBoxStudioPath(pathname: string): boolean {
  return pathname === '/box-studio' || pathname === '/tools/box-studio';
}

export function shouldShowBoxStudioByDefault(): boolean {
  try {
    return isBoxStudioPath(window.location.pathname);
  } catch {
    return false;
  }
}

function resolveInitialState(options?: CreateAppDialogsStoreOptions): AppDialogsState {
  return {
    ...appDialogsInitialState,
    showSetup: options?.initialShowSetup ?? shouldShowSetupByDefault(),
    showBoxStudio: options?.initialShowBoxStudio ?? shouldShowBoxStudioByDefault(),
  };
}

function resolveBoolean(value: BooleanSetterValue, current: boolean): boolean {
  return typeof value === 'function' ? value(current) : value;
}

export function createAppDialogsStore(
  options?: CreateAppDialogsStoreOptions,
): UseBoundStore<StoreApi<AppDialogsStore>> {
  const initialState = resolveInitialState(options);
  return create<AppDialogsStore>((set) => ({
    ...initialState,
    openSettings: (tab = 'machine') => set({ settingsOpen: true, settingsInitialTab: tab }),
    closeSettings: () => set({ settingsOpen: false }),
    setShowTextDialog: (show) => set(state => ({ showTextDialog: resolveBoolean(show, state.showTextDialog) })),
    setEditingTextId: (id) => set({ editingTextId: id }),
    setTextInput: (text) => set({ textInput: text }),
    setTextFont: (font) => set({ textFont: font }),
    setTextSize: (size) => set({ textSize: size }),
    setTextBold: (bold) => set(state => ({ textBold: resolveBoolean(bold, state.textBold) })),
    setTextItalic: (italic) => set(state => ({ textItalic: resolveBoolean(italic, state.textItalic) })),
    openTextEdit: (obj) => {
      const geom = obj.geometry as TextGeometry;
      set({
        textInput: geom.text || '',
        textFont: geom.fontFamily || 'Arial',
        textSize: geom.fontSize || 20,
        textBold: geom.bold || false,
        textItalic: geom.italic || false,
        editingTextId: obj.id,
        showTextDialog: true,
      });
    },
    closeTextDialog: () => set({
      showTextDialog: false,
      editingTextId: null,
      textInput: '',
    }),
    setShowMaterialTest: (show) => set(state => ({ showMaterialTest: resolveBoolean(show, state.showMaterialTest) })),
    setShowCalibrateMaterial: (show) => set(state => ({ showCalibrateMaterial: resolveBoolean(show, state.showCalibrateMaterial) })),
    setShowMaterialLibrary: (show) => set(state => ({ showMaterialLibrary: resolveBoolean(show, state.showMaterialLibrary) })),
    bumpMaterialLibraryRevision: () => set(state => ({ materialLibraryRevision: state.materialLibraryRevision + 1 })),
    setShowCamera: (show) => set(state => ({ showCamera: resolveBoolean(show, state.showCamera) })),
    setLastCalibrationGridResult: (result) => set({ lastCalibrationGridResult: result }),
    setShowKerfWizard: (show) => set(state => ({ showKerfWizard: resolveBoolean(show, state.showKerfWizard) })),
    setShowFontCredits: (show) => set(state => ({ showFontCredits: resolveBoolean(show, state.showFontCredits) })),
    setShowBoxGenerator: (show) => set(state => ({ showBoxGenerator: resolveBoolean(show, state.showBoxGenerator) })),
    setShowGridArray: (show) => set(state => ({ showGridArray: resolveBoolean(show, state.showGridArray) })),
    setGridArrayBounds: (bounds) => set({ gridArrayBounds: bounds }),
    setShowNesting: (show) => set(state => ({ showNesting: resolveBoolean(show, state.showNesting) })),
    setShowToolpathPreview: (show) => set(state => ({ showToolpathPreview: resolveBoolean(show, state.showToolpathPreview) })),
    setToolpathPreviewMoves: (moves) => set({ toolpathPreviewMoves: moves }),
    clearToolpathPreview: () => set({ showToolpathPreview: false, toolpathPreviewMoves: null }),
    setGcodePreview: (gcode) => set({ gcodePreview: gcode }),
    setIsDragOver: (show) => set(state => ({ isDragOver: resolveBoolean(show, state.isDragOver) })),
    setTextPlacementHint: (hint) => set({ textPlacementHint: hint }),
    setTextPlacementPt: (point) => set({ textPlacementPt: point }),
    setTextPreviewFontReady: (ready) => set({ textPreviewFontReady: ready }),
    setShowVariableText: (show) => set(state => ({ showVariableText: resolveBoolean(show, state.showVariableText) })),
    setVariableTextSource: (source) => set({ variableTextSource: source }),
    setShowConnection: (show) => set(state => ({ showConnection: resolveBoolean(show, state.showConnection) })),
    setShowToolpath: (show) => set(state => ({ showToolpath: resolveBoolean(show, state.showToolpath) })),
    setShowShortcuts: (show) => set(state => ({ showShortcuts: resolveBoolean(show, state.showShortcuts) })),
    setShowTemplates: (show) => set(state => ({ showTemplates: resolveBoolean(show, state.showTemplates) })),
    setShowMaterial: (show) => set(state => ({ showMaterial: resolveBoolean(show, state.showMaterial) })),
    setShowSetup: (show) => set(state => ({ showSetup: resolveBoolean(show, state.showSetup) })),
    setShowRecover: (show) => set(state => ({ showRecover: resolveBoolean(show, state.showRecover) })),
    setRecoverAutosaveTimeLabel: (label) => set({ recoverAutosaveTimeLabel: label }),
    setToastSuggestion: (suggestion) => set({ toastSuggestion: suggestion }),
    setShowFeedback: (show) => set(state => ({ showFeedback: resolveBoolean(show, state.showFeedback) })),
    setShowBoxStudio: (show) => set(state => ({ showBoxStudio: resolveBoolean(show, state.showBoxStudio) })),
    resetDialogs: () => set(initialState),
  }));
}

export const useAppDialogsStore = createAppDialogsStore();
