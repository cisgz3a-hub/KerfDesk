import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectWithLine } from '../../__fixtures__/file-actions';
import type { StatusReport } from '../../core/controllers/grbl';
import type { ControllerSettingsSnapshot } from '../../core/preflight';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { PlatformProvider } from './platform-context';
import { GcodeSaveDialog } from './GcodeSaveDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState(initialLaserState());
});

describe.each(['web', 'electron'] as const)('%s G-code prebuild dialog', (platformId) => {
  it('does not select a destination until complete bytes are ready and the operator clicks', async () => {
    useStore.setState({ project: projectWithLine() });
    const write = vi.fn(async () => undefined);
    const pickFileForSave = vi.fn(async () => ({ displayName: 'job.gcode', write }));
    const mounted = await mount(platform(platformId, pickFileForSave));
    try {
      expect(pickFileForSave).not.toHaveBeenCalled();
      const button = destinationButton(mounted.host);
      await act(async () => {
        await vi.waitFor(() => expect(button.disabled).toBe(false));
      });
      expect(mounted.host.textContent).toContain('complete export is ready');
      expect(pickFileForSave).not.toHaveBeenCalled();

      await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
      });
      expect(pickFileForSave).toHaveBeenCalledOnce();
    } finally {
      await mounted.unmount();
    }
  });
});

function platform(
  id: 'web' | 'electron',
  pickFileForSave: PlatformAdapter['pickFileForSave'],
): PlatformAdapter {
  return {
    id,
    pickFilesForOpen: async () => [],
    pickFileForSave,
    serial: { isSupported: () => false, requestPort: async () => null },
  };
}

function destinationButton(host: HTMLElement): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((item) =>
    item.textContent?.includes('Choose destination'),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error('destination button missing');
  return button;
}

async function mount(adapter: PlatformAdapter): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={adapter}>
        <GcodeSaveDialog onClose={() => undefined} />
      </PlatformProvider>,
    );
  });
  return {
    host,
    unmount: async () => {
      await act(async () => root?.unmount());
      host.remove();
    },
  };
}

describe('G-code save placement units (ADR-327)', () => {
  it('places a Current Position export with the controller report units', async () => {
    // The line fixture spans scene X 0..10 at Y 0 (machine Y 400 on the default
    // 400 mm front-left bed). With the head at WPos (1, 2) INCHES the anchor must
    // land at 25.4 / 50.8 mm — exactly what Preview and Start compile — not at
    // the raw 1 / 2 the dialog's context used to hand the export resolver.
    useStore.setState({
      project: projectWithLine(),
      jobPlacement: { startFrom: 'current-position', anchor: 'front-left' },
    });
    useLaserStore.setState({
      statusReport: {
        state: 'Idle',
        mPos: null,
        wPos: { x: 1, y: 2, z: 0 },
        wco: null,
      } as unknown as StatusReport,
      controllerSettings: { reportInches: true } as ControllerSettingsSnapshot,
    });
    const written: string[] = [];
    const write = vi.fn(async (data: string | Blob) => {
      written.push(typeof data === 'string' ? data : await data.text());
    });
    const mounted = await mount(platform('web', async () => ({ displayName: 'job.gcode', write })));
    try {
      const button = destinationButton(mounted.host);
      await act(async () => {
        await vi.waitFor(() => expect(button.disabled).toBe(false));
      });
      await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
      });
      const text = written.join('');
      expect(text).toContain('X25.400');
      expect(text).toContain('Y50.800');
      expect(text).not.toMatch(/X1\.000 Y2\.000/);
    } finally {
      await mounted.unmount();
    }
  });
});
