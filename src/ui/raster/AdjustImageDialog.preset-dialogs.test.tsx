// Annoyance audit A1-P2-1 and A1-P2-4: saving an image preset asked its name
// with window.prompt, which Electron does not implement (it throws "prompt()
// is not supported."), and which was refused during a job with a toast about
// discarding work. The name is now asked in the app (ADR-707), and the
// dialog's notices are toasts.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import type { PlatformAdapter } from '../../platform/types';
import { createLayer, type RasterImage } from '../../core/scene';
import { PlatformProvider } from '../app/platform-context';
import { AppDialogHost } from '../common/AppDialogHost';
import { clearAppDialogs } from '../state/app-dialog-test-helpers';
import { JOB_ACTIVE_CONFIRM_BLOCKED } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { AdjustImageDialog } from './AdjustImageDialog';
import { exportUserImagePresetsFile, readUserImagePresets } from './AdjustImageDialog.user-presets';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const image: RasterImage = {
  kind: 'raster-image',
  id: 'image-1',
  source: 'photo.png',
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  pixelWidth: 2,
  pixelHeight: 1,
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationDeg: 0, mirrorX: false, mirrorY: false },
  color: '#808080',
  dither: 'threshold',
  linesPerMm: 10,
  lumaBase64: 'AP8=',
  brightness: 0,
  contrast: 0,
  gamma: 1,
};

const layer = {
  ...createLayer({ id: '#808080', color: '#808080', mode: 'image' }),
  power: 40,
  minPower: 5,
  linesPerMm: 10,
};

let host: HTMLDivElement;
let root: Root;
// What Electron 44.9.1 does (measured, annoyance audit A1-P2-1).
const nativePrompt = vi.fn((): string | null => {
  throw new Error('prompt() is not supported.');
});
const nativeAlert = vi.fn<(message?: string) => void>();

async function mount(platform?: PlatformAdapter): Promise<void> {
  const dialog = (
    <AdjustImageDialog
      image={image}
      layer={layer}
      onCancel={() => undefined}
      onApply={() => undefined}
    />
  );
  await act(async () => {
    root = createRoot(host);
    root.render(
      <>
        {platform === undefined ? (
          dialog
        ) : (
          <PlatformProvider adapter={platform}>{dialog}</PlatformProvider>
        )}
        <AppDialogHost />
      </>,
    );
  });
}

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  nativePrompt.mockClear();
  vi.spyOn(window, 'prompt').mockImplementation(nativePrompt);
  nativeAlert.mockClear();
  vi.spyOn(window, 'alert').mockImplementation(nativeAlert);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearAppDialogs();
  useLaserStore.setState({ streamer: null });
  useToastStore.setState({ toasts: [] });
  useUiStore.setState({ modalDepth: 0 });
  vi.restoreAllMocks();
  localStorage.clear();
});

function namePrompt(): HTMLElement {
  const dialogs = host.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
  const top = dialogs[dialogs.length - 1];
  if (top === undefined || top.querySelector('h2')?.textContent !== 'Save image preset') {
    throw new Error('the preset name prompt is not open');
  }
  return top;
}

async function pressSave(): Promise<void> {
  const save = host.querySelector<HTMLButtonElement>('button[name="saveImagePreset"]');
  if (save === null) throw new Error('Save preset button missing');
  await act(async () => save.click());
}

async function typeName(value: string): Promise<void> {
  const field = namePrompt().querySelector<HTMLInputElement>('input[type="text"]');
  if (field === null) throw new Error('name field missing');
  await act(async () => {
    Simulate.change(field, { target: { value } as unknown as EventTarget });
  });
}

async function submitName(): Promise<void> {
  const form = namePrompt().querySelector('form');
  if (form === null) throw new Error('name form missing');
  await act(async () => {
    Simulate.submit(form);
  });
}

function toasts(): ReadonlyArray<{ readonly message: string; readonly variant: string }> {
  return useToastStore.getState().toasts.map(({ message, variant }) => ({ message, variant }));
}

describe('Adjust Image: saving a preset asks its name in the app', () => {
  it('saves where window.prompt throws, as it does in the desktop app', async () => {
    await mount();

    await pressSave();
    expect(nativePrompt).not.toHaveBeenCalled();
    expect(namePrompt().textContent).toContain('Preset name');
    await typeName('Wood logo');
    await submitName();

    expect(readUserImagePresets().map((preset) => preset.name)).toEqual(['Wood logo']);
    expect(host.querySelector<HTMLSelectElement>('select[name="imagePreset"]')?.value).toBe(
      'user:Wood logo',
    );
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(toasts()).toEqual([]);
  });

  it('says a refused name under the field and keeps what was typed', async () => {
    await mount();

    await pressSave();
    await submitName();
    expect(namePrompt().querySelector('[role="alert"]')?.textContent).toBe(
      'Image preset name is required.',
    );

    await typeName('Basic');
    await submitName();
    expect(namePrompt().querySelector('[role="alert"]')?.textContent).toBe(
      'That image preset name is reserved.',
    );
    expect(namePrompt().querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('Basic');
    expect(readUserImagePresets()).toEqual([]);
    expect(nativeAlert).not.toHaveBeenCalled();
  });

  it('saves nothing when the name is cancelled', async () => {
    await mount();

    await pressSave();
    await typeName('Wood logo');
    const cancel = [...namePrompt().querySelectorAll('button')].find(
      (button) => button.textContent === 'Cancel',
    );
    await act(async () => cancel?.click());

    expect(readUserImagePresets()).toEqual([]);
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });

  it('saves while a job is running, with no toast about discarding work', async () => {
    useLaserStore.setState({ streamer: step(createStreamer('G1 X1 S100')).state });
    await mount();

    await pressSave();
    await typeName('Slate photo');
    await submitName();

    expect(readUserImagePresets().map((preset) => preset.name)).toEqual(['Slate photo']);
    expect(toasts().map((toast) => toast.message)).not.toContain(JOB_ACTIVE_CONFIRM_BLOCKED);
  });

  it('reports a storage failure as an error toast, not a box', async () => {
    await mount();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    await pressSave();
    await typeName('Wood logo');
    await submitName();

    expect(toasts()).toEqual([
      {
        message: 'Could not save image preset. Browser storage is unavailable.',
        variant: 'error',
      },
    ]);
    expect(nativeAlert).not.toHaveBeenCalled();
  });
});

describe('Adjust Image: preset import reports with toasts', () => {
  function platformOpening(text: string): PlatformAdapter {
    const platform: Partial<PlatformAdapter> = {
      pickFilesForOpen: async () => [{ name: 'image-presets.json', text: async () => text }],
    };
    return platform as PlatformAdapter;
  }

  async function pressImport(): Promise<void> {
    const button = host.querySelector<HTMLButtonElement>('button[name="importImagePresets"]');
    if (button === null) throw new Error('Import button missing');
    await act(async () => button.click());
    await act(async () => undefined);
  }

  it('says how many presets were imported in a success toast', async () => {
    const file = exportUserImagePresetsFile([
      {
        name: 'Slate',
        updatedAt: 1,
        settings: {
          brightness: 0,
          contrast: 0,
          gamma: 1,
          ditherAlgorithm: 'threshold',
          minPower: 0,
          linesPerMm: 10,
          dotWidthCorrectionMm: 0,
          negativeImage: false,
          passThrough: false,
          invertDisplay: false,
        },
      },
    ]);
    await mount(platformOpening(file));

    await pressImport();

    expect(toasts()).toEqual([{ message: 'Imported 1 image preset.', variant: 'success' }]);
    expect(readUserImagePresets().map((preset) => preset.name)).toEqual(['Slate']);
    expect(nativeAlert).not.toHaveBeenCalled();
  });

  it('says why a file was refused in an error toast', async () => {
    await mount(platformOpening('not json'));

    await pressImport();

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]?.variant).toBe('error');
    expect(nativeAlert).not.toHaveBeenCalled();
  });
});
