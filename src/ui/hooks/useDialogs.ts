import { useCallback } from 'react';
import { type SceneObject } from '../../core/scene/SceneObject';
import { useAppDialogsStore } from '../stores/appDialogsStore';

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
  const showTextDialog = useAppDialogsStore(s => s.showTextDialog);
  const setShowTextDialog = useAppDialogsStore(s => s.setShowTextDialog);
  const editingTextId = useAppDialogsStore(s => s.editingTextId);
  const setEditingTextId = useAppDialogsStore(s => s.setEditingTextId);
  const textInput = useAppDialogsStore(s => s.textInput);
  const setTextInput = useAppDialogsStore(s => s.setTextInput);
  const textFont = useAppDialogsStore(s => s.textFont);
  const setTextFont = useAppDialogsStore(s => s.setTextFont);
  const textSize = useAppDialogsStore(s => s.textSize);
  const setTextSize = useAppDialogsStore(s => s.setTextSize);
  const textBold = useAppDialogsStore(s => s.textBold);
  const setTextBold = useAppDialogsStore(s => s.setTextBold);
  const textItalic = useAppDialogsStore(s => s.textItalic);
  const setTextItalic = useAppDialogsStore(s => s.setTextItalic);
  const openTextEdit = useAppDialogsStore(s => s.openTextEdit);
  const closeTextDialog = useAppDialogsStore(s => s.closeTextDialog);

  const showBoxGenerator = useAppDialogsStore(s => s.showBoxGenerator);
  const setShowBoxGenerator = useAppDialogsStore(s => s.setShowBoxGenerator);
  const showVariableText = useAppDialogsStore(s => s.showVariableText);
  const setShowVariableText = useAppDialogsStore(s => s.setShowVariableText);
  const variableTextSource = useAppDialogsStore(s => s.variableTextSource);
  const setVariableTextSource = useAppDialogsStore(s => s.setVariableTextSource);
  const showConnection = useAppDialogsStore(s => s.showConnection);
  const setShowConnection = useAppDialogsStore(s => s.setShowConnection);
  const showToolpath = useAppDialogsStore(s => s.showToolpath);
  const setShowToolpath = useAppDialogsStore(s => s.setShowToolpath);
  const showShortcuts = useAppDialogsStore(s => s.showShortcuts);
  const setShowShortcuts = useAppDialogsStore(s => s.setShowShortcuts);
  const showTemplates = useAppDialogsStore(s => s.showTemplates);
  const setShowTemplates = useAppDialogsStore(s => s.setShowTemplates);
  const showMaterial = useAppDialogsStore(s => s.showMaterial);
  const setShowMaterial = useAppDialogsStore(s => s.setShowMaterial);
  const showSetup = useAppDialogsStore(s => s.showSetup);
  const setShowSetup = useAppDialogsStore(s => s.setShowSetup);
  const showFeedback = useAppDialogsStore(s => s.showFeedback);
  const setShowFeedback = useAppDialogsStore(s => s.setShowFeedback);

  const openVariableText = useCallback((obj: SceneObject) => {
    setVariableTextSource(obj);
    setShowVariableText(true);
  }, [setShowVariableText, setVariableTextSource]);

  const closeVariableText = useCallback(() => {
    setShowVariableText(false);
    setVariableTextSource(null);
  }, [setShowVariableText, setVariableTextSource]);

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
