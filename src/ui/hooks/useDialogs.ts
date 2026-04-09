import { useState, useCallback } from 'react';
import { type SceneObject, type TextGeometry } from '../../core/scene/SceneObject';

/** Wizard key: Electron uses a separate key so browser dev `laserforge_setup_complete` does not skip the wizard in the packaged app. */
function getSetupStorageKey(): string {
  try {
    if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
      return 'laserforge_setup_complete_electron';
    }
  } catch {
    /* ignore */
  }
  return 'laserforge_setup_complete';
}

export interface DialogState {
  showTextDialog: boolean;
  editingTextId: string | null;
  textInput: string;
  textFont: string;
  textSize: number;
  textBold: boolean;
  textItalic: boolean;

  showBoxGenerator: boolean;
  showVariableText: boolean;
  variableTextSource: SceneObject | null;
  showConnection: boolean;
  showToolpath: boolean;
  showShortcuts: boolean;
  showTemplates: boolean;
  showMaterial: boolean;
  showSetup: boolean;
  showFeedback: boolean;
}

export function useDialogs() {
  const [showTextDialog, setShowTextDialog] = useState(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [textInput, setTextInput] = useState('');
  const [textFont, setTextFont] = useState('Arial');
  const [textSize, setTextSize] = useState(20);
  const [textBold, setTextBold] = useState(false);
  const [textItalic, setTextItalic] = useState(false);

  const [showBoxGenerator, setShowBoxGenerator] = useState(false);
  const [showVariableText, setShowVariableText] = useState(false);
  const [variableTextSource, setVariableTextSource] = useState<SceneObject | null>(null);
  const [showConnection, setShowConnection] = useState(false);
  const [showToolpath, setShowToolpath] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showMaterial, setShowMaterial] = useState(false);
  const [showSetup, setShowSetup] = useState(() => {
    try {
      return !localStorage.getItem(getSetupStorageKey());
    } catch {
      return true;
    }
  });
  const [showFeedback, setShowFeedback] = useState(false);

  const openTextEdit = useCallback((obj: SceneObject) => {
    const geom = obj.geometry as TextGeometry;
    setTextInput(geom.text || '');
    setTextFont(geom.fontFamily || 'Arial');
    setTextSize(geom.fontSize || 20);
    setTextBold(geom.bold || false);
    setTextItalic(geom.italic || false);
    setEditingTextId(obj.id);
    setShowTextDialog(true);
  }, []);

  const closeTextDialog = useCallback(() => {
    setShowTextDialog(false);
    setEditingTextId(null);
    setTextInput('');
  }, []);

  const openVariableText = useCallback((obj: SceneObject) => {
    setVariableTextSource(obj);
    setShowVariableText(true);
  }, []);

  const closeVariableText = useCallback(() => {
    setShowVariableText(false);
    setVariableTextSource(null);
  }, []);

  return {
    showTextDialog,
    setShowTextDialog,
    editingTextId,
    setEditingTextId,
    textInput,
    setTextInput,
    textFont,
    setTextFont,
    textSize,
    setTextSize,
    textBold,
    setTextBold,
    textItalic,
    setTextItalic,
    openTextEdit,
    closeTextDialog,

    showBoxGenerator,
    setShowBoxGenerator,
    showVariableText,
    variableTextSource,
    setShowVariableText,
    setVariableTextSource,
    openVariableText,
    closeVariableText,
    showConnection,
    setShowConnection,
    showToolpath,
    setShowToolpath,
    showShortcuts,
    setShowShortcuts,
    showTemplates,
    setShowTemplates,
    showMaterial,
    setShowMaterial,
    showSetup,
    setShowSetup,
    showFeedback,
    setShowFeedback,
  };
}
