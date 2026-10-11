import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { runImagePickAction } from '../commands/image-pick-action';
import { useImageEditorStore } from '../image-editor/image-editor-store';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { DesignPhotoWorkspace } from './DesignPhotoWorkspace';

vi.mock('../app/platform-context', () => ({ usePlatformOptional: () => ({ kind: 'test' }) }));
vi.mock('../commands/image-pick-action', () => ({ runImagePickAction: vi.fn() }));
vi.mock('../image-editor/ImageEditorHost', () => ({
  ImageEditorHost: () => <div>Embedded photo editor</div>,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalOpenEditor = useImageEditorStore.getState().openEditor;
const openEditor = vi.fn();
let host: HTMLDivElement;
let root: Root;
let mounted: boolean;

function photo(id = 'photo'): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,AA==',
    pixelWidth: 4,
    pixelHeight: 4,
    bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
  };
}

function setPhotos(...photos: RasterImage[]): void {
  const project = createProject();
  useStore.setState({ project: { ...project, scene: { ...project.scene, objects: photos } } });
}

beforeEach(() => {
  resetStore();
  openEditor.mockReset();
  vi.mocked(runImagePickAction).mockReset();
  useImageEditorStore.setState({
    session: null,
    sessionOwner: null,
    loadState: { kind: 'idle' },
    openEditor,
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  mounted = true;
});

afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  host.remove();
  useImageEditorStore.setState({ openEditor: originalOpenEditor });
  for (const toast of useToastStore.getState().toasts)
    useToastStore.getState().dismissToast(toast.id);
});

async function importPhoto(): Promise<void> {
  await act(async () => root.render(<DesignPhotoWorkspace />));
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent === 'Import photo',
  );
  if (button === undefined) throw new Error('Import photo button missing');
  await act(async () => button.click());
}

describe('Design Studio project photo workflow', () => {
  it('prevents choosing another photo while an import is pending', async () => {
    setPhotos(photo('existing'));
    let resolve!: (value: null) => void;
    vi.mocked(runImagePickAction).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await importPhoto();
    const card = host.querySelector<HTMLButtonElement>('[aria-label="Edit photo existing.png"]');
    expect(card?.disabled).toBe(true);
    await act(async () => card?.click());
    expect(openEditor).not.toHaveBeenCalled();
    await act(async () => resolve(null));
    expect(card?.disabled).toBe(false);
  });
  it('opens the fitted scene image instead of the picker return value', async () => {
    const returned = photo();
    const fitted = { ...returned, bounds: { minX: 10, minY: 10, maxX: 12, maxY: 12 } };
    vi.mocked(runImagePickAction).mockImplementation(async () => {
      setPhotos(fitted);
      return returned;
    });
    await importPhoto();
    expect(openEditor).toHaveBeenCalledExactlyOnceWith(fitted);
    expect(openEditor.mock.calls[0]?.[0]).toBe(fitted);
  });

  it('opens a selected existing project image', async () => {
    const existing = photo('existing');
    setPhotos(existing);
    await act(async () => root.render(<DesignPhotoWorkspace />));
    const card = host.querySelector<HTMLButtonElement>('[aria-label="Edit photo existing.png"]');
    expect(card).not.toBeNull();
    await act(async () => card?.click());
    expect(openEditor).toHaveBeenCalledExactlyOnceWith(existing);
    expect(runImagePickAction).not.toHaveBeenCalled();
  });

  it('keeps the chooser available after cancellation or failure', async () => {
    vi.mocked(runImagePickAction).mockResolvedValueOnce(null);
    await importPhoto();
    expect(openEditor).not.toHaveBeenCalled();
    vi.mocked(runImagePickAction).mockRejectedValueOnce(new Error('Unreadable file'));
    await importPhoto();
    expect(openEditor).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      'Could not import photo: Unreadable file',
    );
    expect(host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(false);
  });

  it.each(['unmount', 'new document'] as const)(
    'does not reopen a late import after %s',
    async (change) => {
      const returned = photo();
      let resolve!: (value: SceneObject | null) => void;
      vi.mocked(runImagePickAction).mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      await importPhoto();
      if (change === 'unmount') {
        await act(async () => root.unmount());
        mounted = false;
      } else {
        await act(async () =>
          useStore.setState({ projectDocumentEpoch: useStore.getState().projectDocumentEpoch + 1 }),
        );
      }
      await act(async () => {
        setPhotos(returned);
        resolve(returned);
      });
      expect(openEditor).not.toHaveBeenCalled();
    },
  );
});
