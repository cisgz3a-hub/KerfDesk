import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { NumericEditsBar } from './NumericEditsBar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe('NumericEditsBar aspect lock', () => {
  // UX audit U3-P3-2: the lock stays off by default, so it says which state it
  // is in, and a photo stretched by one typed side says how to get it back.
  it('names the lock state in its tooltip', async () => {
    installPhoto();
    const container = await render(<NumericEditsBar />);
    const lock = button(container, 'Lock aspect ratio');
    expect(lock.title).toMatch(/^Unlocked: width and height change separately/);
    await act(async () => lock.click());
    expect(lock.title).toMatch(/^Locked: width and height stay in proportion/);
  });

  it('says how to undo a photo stretched by one typed side', async () => {
    installPhoto();
    const container = await render(<NumericEditsBar />);
    await typeAndPress(input(container, 'Selection width'), '100');
    const toasts = useToastStore.getState().toasts;
    expect(toasts.map((toast) => toast.message)).toEqual([
      'Only one side of the image changed, so it is stretched. Undo (Ctrl+Z) restores it; turn on the lock beside W and H to keep its proportions.',
    ]);
  });

  it('says nothing when the lock keeps the photo in proportion', async () => {
    installPhoto();
    const container = await render(<NumericEditsBar />);
    await act(async () => button(container, 'Lock aspect ratio').click());
    await typeAndPress(input(container, 'Selection width'), '100');
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

async function render(node: JSX.Element): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(node);
  });
  return host;
}

function input(container: HTMLDivElement, label: string): HTMLInputElement {
  const found = container.querySelector(`input[aria-label="${label}"]`);
  if (!(found instanceof HTMLInputElement)) throw new Error(`${label} missing`);
  return found;
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = container.querySelector(`button[aria-label="${label}"]`);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`${label} missing`);
  return found;
}

async function typeAndPress(inputElement: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('native input value setter missing');
  await act(async () => {
    setter.call(inputElement, value);
    inputElement.dispatchEvent(new InputEvent('input', { bubbles: true }));
    inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

function installPhoto(): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        layers: [],
        objects: [
          {
            kind: 'raster-image',
            id: 'photo-1',
            source: 'photo.jpg',
            dataUrl: 'data:image/png;base64,unused',
            pixelWidth: 1,
            pixelHeight: 1,
            bounds: { minX: 0, minY: 0, maxX: 360, maxY: 270 },
            transform: IDENTITY_TRANSFORM,
            color: '#808080',
            dither: 'threshold',
            linesPerMm: 10,
            lumaBase64: 'AA==',
          },
        ],
      },
    },
    selectedObjectId: 'photo-1',
    additionalSelectedIds: new Set(),
    undoStack: [],
  });
}
