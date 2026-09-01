import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { rectSelection } from '../../core/image-select/marquee';
import { useAdjustDialogStore } from './adjust-dialog-store';
import { createSession, withSelection } from './editor-session';
import { handleEditorKeyDown, handleEditorKeyUp } from './editor-shortcuts';
import { useImageEditorStore } from './image-editor-store';

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

beforeEach(() => {
  const session = withSelection(
    createSession('obj-1', 'test.png', createRgbaBuffer(16, 16), BOUNDS),
    rectSelection(16, 16, { x: 2, y: 3, width: 4, height: 5 }),
  );
  useAdjustDialogStore.setState({ dialog: null });
  useImageEditorStore.setState({
    session,
    transform: null,
    pendingCrop: null,
    tool: { kind: 'brush' },
    isSpacePanning: false,
  });
});

describe('Image Studio shortcut ownership', () => {
  it('does not consume Space, arrows, Enter, or Ctrl+A from native controls', () => {
    const input = document.createElement('input');
    const button = document.createElement('button');
    const select = document.createElement('select');
    const roleButton = document.createElement('div');
    roleButton.setAttribute('role', 'button');
    const roleSlider = document.createElement('div');
    roleSlider.setAttribute('role', 'slider');
    const beforeSelection = useImageEditorStore.getState().session?.selection;
    const cases = [
      keyEvent(input, ' '),
      keyEvent(select, 'ArrowRight'),
      keyEvent(button, 'Enter'),
      keyEvent(input, 'a', { ctrlKey: true }),
      keyEvent(roleButton, 'Enter'),
      keyEvent(roleSlider, 'ArrowRight'),
    ];

    for (const testCase of cases) {
      handleEditorKeyDown(testCase.event);
      expect(testCase.preventDefault).not.toHaveBeenCalled();
    }

    expect(useImageEditorStore.getState().isSpacePanning).toBe(false);
    expect(useImageEditorStore.getState().session?.selection).toEqual(beforeSelection);
  });

  it('leaves a key already handled by a nested custom control untouched', () => {
    const beforeSelection = useImageEditorStore.getState().session?.selection;
    const testCase = keyEvent(document.createElement('div'), 'ArrowRight', {
      defaultPrevented: true,
    });

    handleEditorKeyDown(testCase.event);

    expect(testCase.preventDefault).not.toHaveBeenCalled();
    expect(useImageEditorStore.getState().session?.selection).toEqual(beforeSelection);
  });

  it('releases an owned Space pan without consuming a native-control keyup', () => {
    useImageEditorStore.setState({ isSpacePanning: true });
    const testCase = keyEvent(document.createElement('input'), ' ');

    handleEditorKeyUp(testCase.event);

    expect(testCase.preventDefault).not.toHaveBeenCalled();
    expect(useImageEditorStore.getState().isSpacePanning).toBe(false);
  });
});

function keyEvent(
  target: EventTarget,
  key: string,
  modifiers: {
    readonly ctrlKey?: boolean;
    readonly metaKey?: boolean;
    readonly defaultPrevented?: boolean;
  } = {},
): {
  readonly event: React.KeyboardEvent;
  readonly preventDefault: ReturnType<typeof vi.fn>;
} {
  const preventDefault = vi.fn();
  return {
    event: {
      key,
      ctrlKey: modifiers.ctrlKey ?? false,
      metaKey: modifiers.metaKey ?? false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: modifiers.defaultPrevented ?? false,
      target,
      preventDefault,
    } as unknown as React.KeyboardEvent,
    preventDefault,
  };
}
