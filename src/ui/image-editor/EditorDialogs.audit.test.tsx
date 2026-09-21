import { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { rectSelection } from '../../core/image-select';
import { createSession } from './editor-session';
import { useImageEditorStore as editor } from './image-editor-store';
import { useAdjustDialogStore as adjust } from './adjust-dialog-store';
import { useResizeDialogStore as resize } from './resize-dialog-store';
import { useTextDialogStore as textDialog } from './text-dialog-store';
import { ADJUSTMENTS } from './editor-adjustments';
import { EditorAdjustMenus } from './EditorAdjustMenus';
import { AdjustDialogPanel } from './AdjustDialog';
import { ResizeDialogPanel } from './ResizeDialog';
import { TextDialog } from './TextDialog';
import { SelectionModifyRow } from './EditorSelectionControls';
import { ImageEditorTopBar } from './ImageEditorTopBar';
import { clickControl, clickElement, control, mountControl } from './control-audit-test-support';

const raster = vi.hoisted(() => vi.fn());
vi.mock('./editor-text-raster', () => ({ rasterizeTextLayer: raster }));
beforeEach(() => {
  editor.setState({
    session: createSession('audit', 'audit.png', createRgbaBuffer(8, 4), {
      minX: 0,
      minY: 0,
      maxX: 8,
      maxY: 4,
    }),
    sessionOwner: null,
    transform: null,
  });
  adjust.setState({ dialog: null });
  resize.setState({ dialog: null });
  textDialog.getState().close();
  raster.mockReset();
});
afterEach(() => vi.restoreAllMocks());

it.each(ADJUSTMENTS)(
  'menu routes $id to its actual dialog or instant image operation',
  async (spec) => {
    const host = await mountControl(<EditorAdjustMenus />);
    await clickControl(host, spec.menu === 'adjust' ? 'Adjust ▾' : 'Filter ▾');
    const item = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (button) => button.querySelector('span')?.textContent === spec.label,
    )!;
    await clickElement(item);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    if (spec.params.length === 0 && spec.id !== 'curves') {
      expect(adjust.getState().dialog).toBeNull();
      expect(editor.getState().session?.history.undoStack).toHaveLength(1);
      expect(editor.getState().session?.doc.data[0]).toBe(spec.id === 'invert' ? 0 : 255);
    } else expect(adjust.getState().dialog?.id).toBe(spec.id);
  },
);

it('Image menu routes both resize kinds, Text opens its dialog and backdrop dismisses a menu', async () => {
  const host = await mountControl(<EditorAdjustMenus />);
  for (const [label, kind] of [
    ['Image Size', 'image-size'],
    ['Canvas Size', 'canvas-size'],
  ]) {
    await clickControl(host, 'Image ▾');
    await clickControl(host, label!);
    expect(resize.getState().dialog?.kind).toBe(kind);
    await act(async () => resize.getState().cancel());
  }
  await clickControl(host, 'Text…');
  expect(textDialog.getState().isOpen).toBe(true);
  await clickControl(host, 'Adjust ▾');
  await clickElement(host.querySelector<HTMLDivElement>('div[aria-hidden="true"]'));
  expect(host.querySelector('[role="menu"]')).toBeNull();
});

it('adjustment Preview changes preview availability without committing image pixels', async () => {
  adjust.getState().open('brightness-contrast');
  const host = await mountControl(<AdjustDialogPanel />);
  const preview = host.querySelector<HTMLInputElement>('[aria-label="Preview on canvas"]');
  await clickElement(preview);
  expect(adjust.getState().dialog?.previewEnabled).toBe(false);
  await clickElement(preview);
  expect(adjust.getState().dialog?.previewEnabled).toBe(true);
  expect(editor.getState().session?.history.undoStack).toHaveLength(0);
  await clickControl(host, 'Cancel');
});

it('resizes pixels with aspect lock and commits each of the nine canvas anchors', async () => {
  resize.getState().open('image-size');
  const host = await mountControl(<ResizeDialogPanel />);
  await clickElement(host.querySelector<HTMLInputElement>('[aria-label="Constrain proportions"]'));
  expect(resize.getState().dialog?.lockAspect).toBe(false);
  await act(async () => resize.getState().setWidthDraft('12'));
  expect(resize.getState().dialog?.heightDraft).toBe('4');
  await clickControl(host, 'OK');
  expect(editor.getState().session?.doc).toMatchObject({ width: 12, height: 4 });
  await act(async () => resize.getState().open('canvas-size'));
  for (const button of host.querySelectorAll<HTMLButtonElement>('[aria-label="Anchor"] button')) {
    await clickElement(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelectorAll('[aria-label="Anchor"] [aria-pressed="true"]')).toHaveLength(1);
  }
  expect(resize.getState().dialog?.anchor).toEqual({ x: 1, y: 1 });
  await act(async () => resize.getState().setHeightDraft('6'));
  await clickControl(host, 'OK');
  expect(editor.getState().session?.doc).toMatchObject({ width: 12, height: 6 });
});

it('all five Modify buttons dispatch their precise operation and radius into the real selection store', async () => {
  const modify = vi.spyOn(editor.getState(), 'modifySelection');
  editor.getState().select(rectSelection(8, 4, { x: 2, y: 1, width: 3, height: 2 }));
  const host = await mountControl(<SelectionModifyRow />);
  for (const name of ['Expand', 'Contract', 'Border', 'Smooth', 'Feather']) {
    await act(async () =>
      editor.getState().select(rectSelection(8, 4, { x: 2, y: 1, width: 3, height: 2 })),
    );
    await clickControl(host, name);
    expect(modify).toHaveBeenLastCalledWith(name.toLowerCase(), 2);
  }
  expect(
    editor.getState().session?.selection?.alpha.some((value) => value > 0 && value < 255),
  ).toBe(true);
});

it('text Cancel preserves layers and OK creates one named layer from the rasterizer boundary', async () => {
  textDialog.getState().open();
  const host = await mountControl(<TextDialog />);
  expect(control(host, 'OK').disabled).toBe(true);
  await clickControl(host, 'Cancel');
  expect(editor.getState().session?.layers).toHaveLength(1);
  await act(async () => textDialog.getState().open());
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => {
    input.value = 'Audit label';
    Simulate.change(input);
  });
  raster.mockResolvedValue(createRgbaBuffer(8, 4));
  await clickControl(host, 'OK');
  expect(raster).toHaveBeenCalledWith(
    8,
    4,
    expect.objectContaining({ text: 'Audit label', color: { r: 0, g: 0, b: 0 } }),
  );
  expect(editor.getState().session?.layers).toHaveLength(2);
  expect(editor.getState().session?.layers[1]?.name).toContain('Audit label');
  expect(textDialog.getState().isOpen).toBe(false);
});

it('top bar dispatches each session action and prevents empty or in-flight operations', async () => {
  const actions = {
    undo: vi.fn(),
    redo: vi.fn(),
    revert: vi.fn(),
    apply: vi.fn(),
    applyAndTrace: vi.fn(),
    close: vi.fn(),
  };
  const panels = vi.fn();
  const pristine = editor.getState().session!;
  const idle = await mountControl(
    <ImageEditorTopBar
      session={pristine}
      isApplying={false}
      isHistoryOpen={false}
      onToggleHistory={panels}
      actions={actions}
    />,
  );
  for (const label of ['Undo', 'Redo', 'Revert', 'Apply'])
    expect(control(idle, label).disabled).toBe(true);
  editor.getState().select(rectSelection(8, 4, { x: 0, y: 0, width: 8, height: 4 }));
  editor.getState().fillSelection();
  editor.getState().deleteSelection();
  editor.getState().undo();
  const session = editor.getState().session!;
  const host = await mountControl(
    <ImageEditorTopBar
      session={session}
      isApplying={false}
      isHistoryOpen
      onToggleHistory={panels}
      actions={actions}
    />,
  );
  for (const [label, key] of [
    ['Undo', 'undo'],
    ['Redo', 'redo'],
    ['Revert', 'revert'],
    ['Apply', 'apply'],
    ['Apply & Trace', 'applyAndTrace'],
    ['✕', 'close'],
  ] as const) {
    await clickControl(host, label);
    expect(actions[key]).toHaveBeenCalledTimes(1);
  }
  await clickControl(host, 'Panels');
  expect(panels).toHaveBeenCalledTimes(1);
  const applying = await mountControl(
    <ImageEditorTopBar
      session={session}
      isApplying
      isHistoryOpen
      onToggleHistory={panels}
      actions={actions}
    />,
  );
  expect(control(applying, 'Applying…').disabled).toBe(true);
  expect(control(applying, 'Apply & Trace').disabled).toBe(true);
});
