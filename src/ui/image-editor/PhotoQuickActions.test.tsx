import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAdjustDialogStore } from './adjust-dialog-store';
import { createEditorTestBuffer } from './create-editor-test-buffer';
import { createSession } from './editor-session';
import { useImageEditorStore } from './image-editor-store';
import { PhotoQuickActions } from './PhotoQuickActions';
import { useResizeDialogStore } from './resize-dialog-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const pixels = createEditorTestBuffer(2, 2);
  for (let index = 0; index < pixels.data.length; index += 4) {
    pixels.data[index] = 100;
    pixels.data[index + 1] = 100;
    pixels.data[index + 2] = 100;
  }
  useImageEditorStore.setState({
    session: createSession('photo', 'paper.png', pixels, {
      minX: 0,
      minY: 0,
      maxX: 2,
      maxY: 2,
    }),
    sessionOwner: null,
    transform: null,
    tool: { kind: 'brush' },
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useAdjustDialogStore.setState({ dialog: null });
  useResizeDialogStore.setState({ dialog: null });
  useImageEditorStore.setState({ session: null, sessionOwner: null, transform: null });
});

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent === label,
  );
  if (found === undefined) throw new Error(`Missing ${label}`);
  return found;
}

describe('Photo quick tools', () => {
  it('previews a black and white adjustment without changing pixels until commit, then undoes it', async () => {
    await act(async () => root.render(<PhotoQuickActions />));
    const original = useImageEditorStore.getState().session!;
    await act(async () => button('Black & white').click());
    expect(useAdjustDialogStore.getState().dialog?.id).toBe('threshold');
    expect(useImageEditorStore.getState().session).toBe(original);
    await act(async () => useAdjustDialogStore.getState().commit());
    expect(useImageEditorStore.getState().session?.doc.data[0]).toBe(0);
    await act(async () => useImageEditorStore.getState().undo());
    expect(useImageEditorStore.getState().session?.doc.data).toEqual(original.doc.data);
  });

  it('keeps transform work intact when quick actions are clicked', async () => {
    useImageEditorStore.getState().startTransform();
    const transform = useImageEditorStore.getState().transform;
    expect(transform).not.toBeNull();
    await act(async () => root.render(<PhotoQuickActions />));
    for (const item of host.querySelectorAll<HTMLButtonElement>('button')) {
      expect(item.disabled).toBe(true);
      await act(async () => item.click());
    }
    expect(useImageEditorStore.getState().transform).toBe(transform);
    expect(useImageEditorStore.getState().tool.kind).toBe('brush');
    expect(useAdjustDialogStore.getState().dialog).toBeNull();
    expect(useResizeDialogStore.getState().dialog).toBeNull();
  });
});
