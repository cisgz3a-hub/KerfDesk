import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import { createStreamer, step } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { preserveBrowserProProject, usePendingProProjectStore } from '../state/pending-pro-project';
import { PlatformProvider } from './platform-context';
import { ProProjectDesktopDialog } from './ProProjectDesktopDialog';
import { proProject } from './pro-project-test-fixtures';

vi.mock('../../platform/build-capabilities', () => ({ BROWSER_FREE_BUILD: true }));

const initialLaser = useLaserStore.getState();
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  usePendingProProjectStore.setState({ pending: null });
  useLaserStore.setState({ streamer: null });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  usePendingProProjectStore.setState({ pending: null });
  useLaserStore.setState(initialLaser);
  vi.unstubAllGlobals();
});

it('summarises preserved features, offers desktop and keeps a cancelled copy available', async () => {
  const pending = preserveBrowserProProject(proProject(), { source: 'file', name: 'carving.lf2' });
  const pickFileForSave = vi.fn(async () => null);
  await act(async () =>
    root.render(
      <PlatformProvider adapter={mockPlatform({ save: pickFileForSave })}>
        <ProProjectDesktopDialog />
      </PlatformProvider>,
    ),
  );
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('carving.lf2');
  expect(host.querySelector('[aria-label="Project Pro features"]')?.textContent).toContain(
    'V-carve',
  );
  expect(host.querySelector('a')?.getAttribute('href')).toBe('https://kerfdesk.com/download.html');
  const save = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'Save preserved copy',
  );
  await act(async () => save?.click());
  expect(pickFileForSave).toHaveBeenCalledOnce();
  expect(usePendingProProjectStore.getState().pending).toBe(pending);
  const close = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'Close',
  );
  await act(async () => close?.click());
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it('never covers active-job controls and presents the preserved project after the job ends', async () => {
  preserveBrowserProProject(proProject(), { source: 'autosave', name: null });
  const streamer = step(createStreamer('G1 X1')).state;
  useLaserStore.setState({ streamer });
  await act(async () =>
    root.render(
      <PlatformProvider adapter={mockPlatform()}>
        <ProProjectDesktopDialog />
      </PlatformProvider>,
    ),
  );
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector('[role="status"]')?.textContent).toContain('current job continues');
  expect(useLaserStore.getState().streamer).toBe(streamer);
  await act(async () => useLaserStore.setState({ streamer: null }));
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('original autosave remains');
});
