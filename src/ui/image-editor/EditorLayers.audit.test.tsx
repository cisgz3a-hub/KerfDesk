import { act } from 'react';
import { beforeEach, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { selectAllMask } from '../../core/image-select';
import { useTutorialStore } from '../tutorials/tutorial-store';
import { createSession } from './editor-session';
import { useImageEditorStore as editor } from './image-editor-store';
import { LayersPanel } from './LayersPanel';
import { HistoryPanel } from './HistoryPanel';
import { clickControl, control, mountControl } from './control-audit-test-support';

beforeEach(() =>
  editor.setState({
    session: createSession('layer-audit', 'layers.png', createRgbaBuffer(3, 3), {
      minX: 0,
      minY: 0,
      maxX: 3,
      maxY: 3,
    }),
    sessionOwner: null,
    transform: null,
  }),
);
const layerNames = () => editor.getState().session?.layers.map((layer) => layer.id);

it('gates stack-edge actions and adds, reorders, duplicates, deletes and merges actual layers', async () => {
  const host = await mountControl(<LayersPanel />);
  const up = 'Move the active layer up';
  const down = 'Move the active layer down';
  const merge = 'Merge the active layer into the one below it';
  const remove = 'Delete the active layer (the last layer always stays)';
  expect(control(host, up).disabled).toBe(true);
  expect(control(host, down).disabled).toBe(true);
  expect(control(host, merge).disabled).toBe(true);
  expect(control(host, remove).disabled).toBe(true);
  await clickControl(host, 'Add a transparent layer above the active one');
  const added = editor.getState().session?.activeLayerId;
  expect(layerNames()).toHaveLength(2);
  expect(control(host, up).disabled).toBe(true);
  expect(control(host, down).disabled).toBe(false);
  await clickControl(host, down);
  expect(layerNames()?.[0]).toBe(added);
  expect(control(host, down).disabled).toBe(true);
  expect(control(host, merge).disabled).toBe(true);
  await clickControl(host, up);
  expect(layerNames()?.[1]).toBe(added);
  await clickControl(host, 'Duplicate the active layer');
  expect(layerNames()).toHaveLength(3);
  await clickControl(host, remove);
  expect(layerNames()).toHaveLength(2);
  await clickControl(host, merge);
  expect(layerNames()).toHaveLength(1);
});

it('selects paint layers, toggles visibility, and opens the layers lesson', async () => {
  const host = await mountControl(<LayersPanel />);
  await clickControl(host, 'Add a transparent layer above the active one');
  await clickControl(host, 'Background');
  const selected = editor.getState().session?.activeLayerId;
  expect(selected).toBe(editor.getState().session?.layers[0]?.id);
  await clickControl(host, 'Hide this layer');
  expect(editor.getState().session?.layers.at(-1)?.isVisible).toBe(false);
  await clickControl(host, 'Show this layer');
  expect(editor.getState().session?.layers.at(-1)?.isVisible).toBe(true);
  await clickControl(host, 'Tutorial: Image layers');
  expect(useTutorialStore.getState()).toMatchObject({ isOpen: true, tutorialId: 'image-layers' });
});

it('jumps backward and forward through actual image pixels from History rows', async () => {
  editor.getState().setForeground({ r: 0, g: 0, b: 0 });
  editor.getState().select(selectAllMask(3, 3));
  editor.getState().fillSelection();
  const label = editor.getState().session?.history.undoStack[0]?.label;
  expect(label).toBeTruthy();
  const host = await mountControl(<HistoryPanel />);
  await clickControl(host, 'Open');
  expect(editor.getState().session?.doc.data[0]).toBe(255);
  if (!label) throw new Error('History label absent');
  await clickControl(host, label);
  expect(editor.getState().session?.doc.data[0]).toBe(0);
  await clickControl(host, 'Tutorial: Image history');
  expect(useTutorialStore.getState().tutorialId).toBe('image-layers');
  await act(async () => editor.getState().select(null));
});
