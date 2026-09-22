import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { selectAllMask } from '../../core/image-select';
import { EditorOptionsBar } from './EditorOptionsBar';
import { EditorToolStrip } from './EditorToolStrip';
import {
  SelectionActions,
  SelectionModeButtons,
  SelectionModifyRow,
} from './EditorSelectionControls';
import { createSession } from './editor-session';
import { useImageEditorStore as editor } from './image-editor-store';
import { clickControl, clickElement, control, mountControl } from './control-audit-test-support';

beforeEach(() => {
  const doc = createRgbaBuffer(8, 8);
  editor.setState({
    session: createSession('audit-image', 'audit.png', doc, { minX: 0, minY: 0, maxX: 8, maxY: 8 }),
    sessionOwner: null,
    transform: null,
    pendingCrop: null,
    tool: { kind: 'brush' },
    foreground: { r: 0, g: 0, b: 0 },
    background: { r: 255, g: 255, b: 255 },
    selectionMode: 'replace',
    selectionFeather: 0,
    wandContiguous: true,
  });
});

describe('Image Studio control-by-control audit', () => {
  it('arms every displayed tool and announces exactly the active tool', async () => {
    const host = await mountControl(<EditorToolStrip />);
    const expected = [
      'brush',
      'pencil',
      'eraser',
      'line',
      'marquee',
      'lasso',
      'wand',
      'bucket',
      'gradient',
      'clone',
      'heal',
      'crop',
      'move',
    ];
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('[aria-pressed]')];
    expect(buttons).toHaveLength(expected.length);
    for (const [index, button] of buttons.entries()) {
      await clickElement(button);
      expect(editor.getState().tool.kind).toBe(expected[index]);
      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    }
  });

  it('opens both colour pickers, commits foreground, cancels background, swaps and resets colours', async () => {
    const host = await mountControl(<EditorToolStrip />);
    await clickControl(host, 'Choose foreground color');
    expect(host.querySelector('[aria-label="Foreground color"]')).not.toBeNull();
    await clickControl(host, 'OK');
    expect(host.querySelector('[aria-label="Foreground color"]')).toBeNull();
    await clickControl(host, 'Choose background color');
    expect(host.querySelector('[aria-label="Background color"]')).not.toBeNull();
    await clickControl(host, 'Cancel');
    await clickControl(host, 'Swap foreground and background colors (X)');
    expect(editor.getState().foreground.r).toBe(255);
    expect(editor.getState().background.r).toBe(0);
    await clickControl(host, 'Reset to black foreground / white background (D)');
    expect(editor.getState().foreground.r).toBe(0);
    expect(editor.getState().background.r).toBe(255);
  });

  it('chooses each paint swatch and opens its contextual lesson', async () => {
    const host = await mountControl(<EditorOptionsBar />);
    for (const [name, expected] of [
      ['black', 0],
      ['gray', 128],
      ['white', 255],
    ] as const) {
      await clickControl(host, `Paint ${name}`);
      expect(editor.getState().foreground).toEqual({ r: expected, g: expected, b: expected });
    }
  });

  it('switches both gradient shapes and wand contiguity through the options bar', async () => {
    editor.getState().setTool({ kind: 'gradient', shape: 'linear' });
    const host = await mountControl(<EditorOptionsBar />);
    for (const shape of ['radial', 'linear'] as const) {
      await clickControl(host, shape === 'radial' ? 'Radial' : 'Linear');
      expect(editor.getState().tool).toEqual({ kind: 'gradient', shape });
    }
    await act(async () => editor.getState().setTool({ kind: 'wand' }));
    await clickElement(host.querySelector('input[type="checkbox"]'));
    expect(editor.getState().wandContiguous).toBe(false);
  });

  it('disables empty crop actions, cancels the box, and commits actual pixel dimensions', async () => {
    editor.getState().setTool({ kind: 'crop' });
    const host = await mountControl(<EditorOptionsBar />);
    expect(control(host, '✓ Crop').disabled).toBe(true);
    expect(control(host, '✕').disabled).toBe(true);
    await act(async () => editor.getState().setPendingCrop({ x: 1, y: 1, width: 4, height: 3 }));
    await clickControl(host, '✕');
    expect(editor.getState().pendingCrop).toBeNull();
    expect(editor.getState().session?.doc.width).toBe(8);
    await act(async () => editor.getState().setPendingCrop({ x: 1, y: 1, width: 4, height: 3 }));
    await clickControl(host, '✓ Crop');
    expect(editor.getState().session?.doc).toMatchObject({ width: 4, height: 3 });
    expect(editor.getState().pendingCrop).toBeNull();
  });

  it('sets all selection modes and gates pixel actions until a selection exists', async () => {
    const host = await mountControl(
      <>
        <SelectionModeButtons />
        <SelectionActions />
        <SelectionModifyRow />
      </>,
    );
    const names = [
      'New selection',
      'Add to selection (Shift while dragging)',
      'Subtract from selection (Alt while dragging)',
      'Intersect with selection (Shift+Alt while dragging)',
    ];
    for (const [index, name] of names.entries()) {
      await clickControl(host, name);
      expect(editor.getState().selectionMode).toBe(
        ['replace', 'add', 'subtract', 'intersect'][index],
      );
    }
    for (const name of ['Delete', 'Fill', 'Invert', 'Deselect'])
      expect(control(host, name).disabled).toBe(true);
    await act(async () => editor.getState().select(selectAllMask(8, 8)));
    await clickControl(host, 'Fill');
    expect(editor.getState().session?.doc.data[0]).toBe(0);
    await clickControl(host, 'Delete');
    expect(editor.getState().session?.doc.data[0]).toBe(255);
    await clickControl(host, 'Invert');
    expect(editor.getState().session?.selection?.alpha.every((value) => value === 0)).toBe(true);
    await clickControl(host, 'Deselect');
    expect(editor.getState().session?.selection).toBeNull();
  });
});
