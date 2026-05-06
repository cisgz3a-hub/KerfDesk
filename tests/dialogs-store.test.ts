import {
  appDialogsInitialState,
  createAppDialogsStore,
  type SettingsTab,
} from '../src/ui/stores/appDialogsStore';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

{
  const store = createAppDialogsStore();
  const state = store.getState();
  assert(state.settingsOpen === false, 'settings starts closed');
  assert(state.settingsInitialTab === 'machine', 'settings starts on machine tab');
  assert(state.showTextDialog === false, 'text dialog starts closed');
  assert(state.editingTextId === null, 'text dialog starts without editing id');
  assert(state.textInput === '', 'text input starts empty');
  assert(state.textFont === 'Arial', 'text font starts at default');
  assert(state.textSize === 20, 'text size starts at default');
  assert(state.textBold === false, 'text bold starts off');
  assert(state.textItalic === false, 'text italic starts off');
  assert(state.showMaterialTest === false, 'material test starts closed');
  assert(state.showCalibrateMaterial === false, 'calibrate material starts closed');
  assert(state.showMaterialLibrary === false, 'material library starts closed');
  assert(state.materialLibraryRevision === 0, 'material library revision starts at zero');
  assert(state.showCamera === false, 'camera starts closed');
  assert(state.lastCalibrationGridResult === null, 'calibration grid result starts empty');
  assert(state.showKerfWizard === false, 'kerf wizard starts closed');
  assert(state.showFontCredits === false, 'font credits starts closed');
  assert(state.showBoxGenerator === false, 'box generator starts closed');
  assert(state.showBoxStudio === false, 'box studio starts closed without a matching path');
  assert(state.showGridArray === false, 'grid array starts closed');
  assert(state.gridArrayBounds.w === 0 && state.gridArrayBounds.h === 0, 'grid array bounds start empty');
  assert(state.showNesting === false, 'nesting starts closed');
  assert(state.showToolpathPreview === false, 'toolpath preview starts off');
  assert(state.toolpathPreviewMoves === null, 'toolpath preview starts without moves');
  assert(state.gcodePreview === null, 'gcode preview starts closed');
  assert(state.isDragOver === false, 'drag-over starts off');
  assert(state.textPlacementHint === null, 'text placement hint starts empty');
  assert(state.textPlacementPt === null, 'text placement point starts empty');
  assert(state.textPreviewFontReady === true, 'text preview font starts ready');
  assert(state.showVariableText === false, 'variable text starts closed');
  assert(state.variableTextSource === null, 'variable text source starts empty');
  assert(state.showConnection === false, 'connection starts closed');
  assert(state.showToolpath === false, 'toolpath starts closed');
  assert(state.showShortcuts === false, 'shortcuts starts closed');
  assert(state.showTemplates === false, 'templates starts closed');
  assert(state.showMaterial === false, 'material starts closed');
  assert(state.showSetup === true, 'setup starts open when storage is unavailable');
  assert(state.showRecover === false, 'recovery prompt starts closed');
  assert(state.recoverAutosaveTimeLabel === null, 'recovery time label starts empty');
  assert(state.toastSuggestion === null, 'toast suggestion starts empty');
  assert(state.showFeedback === false, 'feedback starts closed');
}

{
  const store = createAppDialogsStore({ initialShowSetup: false });
  assert(store.getState().showSetup === false, 'setup initializer can start closed');
  store.getState().setShowSetup(true);
  assert(store.getState().showSetup === true, 'setup opens');
  store.getState().resetDialogs();
  assert(store.getState().showSetup === false, 'reset preserves configured setup default');
}

{
  const store = createAppDialogsStore({ initialShowBoxStudio: true });
  assert(store.getState().showBoxStudio === true, 'box studio initializer can start open');
  store.getState().setShowBoxStudio(false);
  assert(store.getState().showBoxStudio === false, 'box studio closes');
  store.getState().setShowBoxStudio(current => !current);
  assert(store.getState().showBoxStudio === true, 'box studio supports functional toggle');
  store.getState().resetDialogs();
  assert(store.getState().showBoxStudio === true, 'box studio reset preserves configured route default');
}

{
  const store = createAppDialogsStore();
  store.getState().setShowTextDialog(true);
  store.getState().setEditingTextId('manual');
  store.getState().setTextInput('Hello');
  store.getState().setTextFont('Inter');
  store.getState().setTextSize(42);
  store.getState().setTextBold(true);
  store.getState().setTextItalic(true);

  const state = store.getState();
  assert(state.showTextDialog === true, 'text dialog opens manually');
  assert(state.editingTextId === 'manual', 'editing id updates manually');
  assert(state.textInput === 'Hello', 'text input updates');
  assert(state.textFont === 'Inter', 'text font updates');
  assert(state.textSize === 42, 'text size updates');
  assert(state.textBold === true, 'text bold updates');
  assert(state.textItalic === true, 'text italic updates');
}

{
  const store = createAppDialogsStore();
  store.getState().openTextEdit({
    id: 'text-1',
    type: 'text',
    geometry: {
      type: 'text',
      text: 'Edit me',
      fontFamily: 'JetBrains Mono',
      fontSize: 16,
      bold: true,
      italic: true,
    },
  } as never);

  const opened = store.getState();
  assert(opened.showTextDialog === true, 'openTextEdit opens text dialog');
  assert(opened.editingTextId === 'text-1', 'openTextEdit records editing id');
  assert(opened.textInput === 'Edit me', 'openTextEdit copies text');
  assert(opened.textFont === 'JetBrains Mono', 'openTextEdit copies font');
  assert(opened.textSize === 16, 'openTextEdit copies size');
  assert(opened.textBold === true, 'openTextEdit copies bold');
  assert(opened.textItalic === true, 'openTextEdit copies italic');

  store.getState().closeTextDialog();
  const closed = store.getState();
  assert(closed.showTextDialog === false, 'closeTextDialog closes dialog');
  assert(closed.editingTextId === null, 'closeTextDialog clears editing id');
  assert(closed.textInput === '', 'closeTextDialog clears input');
  assert(closed.textFont === 'JetBrains Mono', 'closeTextDialog preserves chosen font');
}

{
  const store = createAppDialogsStore();
  const observed: boolean[] = [];
  const unsub = store.subscribe((state) => observed.push(state.settingsOpen));
  store.getState().openSettings('gcode');
  store.getState().closeSettings();
  unsub();

  const state = store.getState();
  assert(state.settingsOpen === false, 'closeSettings closes modal');
  assert(state.settingsInitialTab === 'gcode', 'closeSettings preserves last requested tab');
  assert(observed.join(',') === 'true,false', `subscriber saw settings transitions (${observed.join(',')})`);
}

{
  const store = createAppDialogsStore();
  const tabs: SettingsTab[] = ['machine', 'profiles', 'gcode', 'calibration'];
  for (const tab of tabs) {
    store.getState().openSettings(tab);
    assert(store.getState().settingsOpen === true, `${tab}: settings opened`);
    assert(store.getState().settingsInitialTab === tab, `${tab}: tab selected`);
  }
  store.getState().openSettings();
  assert(store.getState().settingsInitialTab === 'machine', 'openSettings defaults to machine tab');
}

{
  const store = createAppDialogsStore();
  store.getState().setShowMaterialTest(true);
  store.getState().setShowCalibrateMaterial(true);
  store.getState().setShowMaterialLibrary(true);
  store.getState().bumpMaterialLibraryRevision();
  store.getState().setShowCamera(true);
  store.getState().setLastCalibrationGridResult({ layers: [], objects: [] } as never);
  store.getState().setShowKerfWizard(true);
  store.getState().setShowFontCredits(true);

  const state = store.getState();
  assert(state.showMaterialTest === true, 'material test opens');
  assert(state.showCalibrateMaterial === true, 'calibrate material opens');
  assert(state.showMaterialLibrary === true, 'material library opens');
  assert(state.materialLibraryRevision === 1, 'material library revision increments');
  assert(state.showCamera === true, 'camera opens');
  assert(state.lastCalibrationGridResult !== null, 'calibration grid result updates');
  assert(state.showKerfWizard === true, 'kerf wizard opens');
  assert(state.showFontCredits === true, 'font credits opens');

  store.getState().resetDialogs();
  const reset = store.getState();
  assert(reset.showMaterialTest === false, 'material test resets closed');
  assert(reset.showCalibrateMaterial === false, 'calibrate material resets closed');
  assert(reset.showMaterialLibrary === false, 'material library resets closed');
  assert(reset.materialLibraryRevision === 0, 'material library revision resets');
  assert(reset.showCamera === false, 'camera resets closed');
  assert(reset.lastCalibrationGridResult === null, 'calibration grid result resets');
  assert(reset.showKerfWizard === false, 'kerf wizard resets closed');
  assert(reset.showFontCredits === false, 'font credits resets closed');
  assert(reset.settingsOpen === appDialogsInitialState.settingsOpen, 'settings reset matches initial open state');
  assert(reset.settingsInitialTab === appDialogsInitialState.settingsInitialTab, 'settings reset matches initial tab');
}

{
  const store = createAppDialogsStore();
  store.getState().setShowBoxGenerator(true);
  store.getState().setShowBoxStudio(true);
  store.getState().setShowGridArray(true);
  store.getState().setGridArrayBounds({ w: 12, h: 34 });
  store.getState().setShowNesting(true);
  store.getState().setShowToolpathPreview(true);
  store.getState().setToolpathPreviewMoves([{ type: 'rapid', to: { x: 1, y: 2 } }]);
  store.getState().setGcodePreview('G1 X1');
  store.getState().setIsDragOver(true);
  store.getState().setTextPlacementHint('Place text');
  store.getState().setTextPlacementPt({ x: 7, y: 8 });
  store.getState().setTextPreviewFontReady(false);
  store.getState().setShowVariableText(true);
  store.getState().setVariableTextSource({ id: 'txt-1', type: 'text' } as never);
  store.getState().setShowConnection(true);
  store.getState().setShowToolpath(true);
  store.getState().setShowShortcuts(true);
  store.getState().setShowTemplates(true);
  store.getState().setShowMaterial(true);
  store.getState().setShowSetup(true);
  store.getState().setShowRecover(true);
  store.getState().setRecoverAutosaveTimeLabel('May 6 12:00');
  store.getState().setToastSuggestion({
    materialName: 'Birch',
    suggestion: {
      power: 45,
      speed: 1200,
      passes: 1,
      confidence: 80,
      sampleCount: 4,
      lastUsed: '2026-05-06T00:00:00.000Z',
    },
  });
  store.getState().setShowFeedback(true);

  const state = store.getState();
  assert(state.showBoxGenerator === true, 'box generator opens');
  assert(state.showBoxStudio === true, 'box studio opens');
  assert(state.showGridArray === true, 'grid array opens');
  assert(state.gridArrayBounds.w === 12 && state.gridArrayBounds.h === 34, 'grid array bounds update');
  assert(state.showNesting === true, 'nesting opens');
  assert(state.showToolpathPreview === true, 'toolpath preview toggles on');
  assert(state.toolpathPreviewMoves?.length === 1, 'toolpath preview moves update');
  assert(state.gcodePreview === 'G1 X1', 'gcode preview updates');
  assert(state.isDragOver === true, 'drag-over toggles on');
  assert(state.textPlacementHint === 'Place text', 'text placement hint updates');
  assert(state.textPlacementPt?.x === 7 && state.textPlacementPt.y === 8, 'text placement point updates');
  assert(state.textPreviewFontReady === false, 'text preview font ready updates');
  assert(state.showVariableText === true, 'variable text opens');
  assert(state.variableTextSource?.id === 'txt-1', 'variable text source stored');
  assert(state.showConnection === true, 'connection opens');
  assert(state.showToolpath === true, 'toolpath opens');
  assert(state.showShortcuts === true, 'shortcuts opens');
  assert(state.showTemplates === true, 'templates opens');
  assert(state.showMaterial === true, 'material opens');
  assert(state.showSetup === true, 'setup opens with setter');
  assert(state.showRecover === true, 'recovery prompt opens');
  assert(state.recoverAutosaveTimeLabel === 'May 6 12:00', 'recovery time label updates');
  assert(state.toastSuggestion?.materialName === 'Birch', 'toast suggestion updates');
  assert(state.showFeedback === true, 'feedback opens');

  store.getState().setShowShortcuts(current => !current);
  assert(store.getState().showShortcuts === false, 'boolean setters accept functional updates');

  store.getState().resetDialogs();
  const reset = store.getState();
  assert(reset.showBoxGenerator === false, 'box generator resets closed');
  assert(reset.showBoxStudio === false, 'box studio resets closed');
  assert(reset.showGridArray === false, 'grid array resets closed');
  assert(reset.gridArrayBounds.w === 0 && reset.gridArrayBounds.h === 0, 'grid array bounds reset empty');
  assert(reset.showNesting === false, 'nesting resets closed');
  assert(reset.showToolpathPreview === false, 'toolpath preview resets off');
  assert(reset.toolpathPreviewMoves === null, 'toolpath preview moves reset empty');
  assert(reset.gcodePreview === null, 'gcode preview resets closed');
  assert(reset.isDragOver === false, 'drag-over resets off');
  assert(reset.textPlacementHint === null, 'text placement hint resets empty');
  assert(reset.textPlacementPt === null, 'text placement point resets empty');
  assert(reset.textPreviewFontReady === true, 'text preview font ready resets on');
  assert(reset.showVariableText === false, 'variable text resets closed');
  assert(reset.variableTextSource === null, 'variable text source resets empty');
  assert(reset.showConnection === false, 'connection resets closed');
  assert(reset.showToolpath === false, 'toolpath resets closed');
  assert(reset.showShortcuts === false, 'shortcuts resets closed');
  assert(reset.showTemplates === false, 'templates resets closed');
  assert(reset.showMaterial === false, 'material resets closed');
  assert(reset.showSetup === true, 'setup resets to unavailable-storage default');
  assert(reset.showRecover === false, 'recovery prompt resets closed');
  assert(reset.recoverAutosaveTimeLabel === null, 'recovery time label resets empty');
  assert(reset.toastSuggestion === null, 'toast suggestion resets empty');
  assert(reset.showFeedback === false, 'feedback resets closed');
}

{
  const store = createAppDialogsStore();
  store.getState().setShowToolpathPreview(current => !current);
  assert(store.getState().showToolpathPreview === true, 'toolpath preview supports functional toggle');
  store.getState().setToolpathPreviewMoves([{ type: 'laserOff' }]);
  store.getState().clearToolpathPreview();
  assert(store.getState().showToolpathPreview === false, 'clearToolpathPreview turns preview off');
  assert(store.getState().toolpathPreviewMoves === null, 'clearToolpathPreview clears moves');
}
