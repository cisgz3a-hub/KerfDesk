import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { PersonalArtworkPanel } from './PersonalArtworkPanel';
import { artworkProject } from './personal-artwork-test-fixtures';
import { capturePersonalArtwork, type PersonalArtwork } from './personal-artwork-model';
import {
  parsePersonalArtworkLibrary,
  serializePersonalArtworkLibrary,
} from './personal-artwork-format';
import type { PersonalArtworkRepository } from './personal-artwork-storage';

let host: HTMLDivElement;
let root: Root;
let records: readonly PersonalArtwork[];
let repository: PersonalArtworkRepository;
const onClose = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  resetStore();
  useStore.setState({
    project: artworkProject(),
    selectedObjectId: 'text',
    additionalSelectedIds: new Set(['image']),
  });
  records = [];
  repository = {
    list: vi.fn(async () => records),
    add: vi.fn(async (entries) => {
      records = [...records, ...entries];
    }),
    remove: vi.fn(async (id) => {
      records = records.filter((entry) => entry.id !== id);
    }),
  };
  onClose.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(platform: Partial<PlatformAdapter> = {}): Promise<void> {
  await act(async () =>
    root.render(
      <PlatformProvider adapter={platform as PlatformAdapter}>
        <PersonalArtworkPanel repository={repository} onClose={onClose} />
      </PlatformProvider>,
    ),
  );
}
function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (found === undefined) throw new Error(`Missing ${text}`);
  return found;
}
async function input(index: number, value: string): Promise<void> {
  const control = host.querySelectorAll('input')[index];
  if (control === undefined) throw new Error('Input missing');
  await act(async () => {
    control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(text: string): Promise<void> {
  await act(async () => button(text).click());
}

it('saves the selection, searches categories, and inserts the saved entry as one undo', async () => {
  await render();
  expect(button('Save selection to My artwork').disabled).toBe(true);
  await input(0, 'School logo');
  await input(1, 'Jigs');
  await click('Save selection to My artwork');
  expect(records).toHaveLength(1);
  expect(host.textContent).toContain('School logo');
  await input(2, 'missing');
  expect(host.textContent).toContain('No saved artwork matches');
  await input(2, 'JIGS');
  expect(button('Insert artwork')).toBeDefined();
  const source = useStore.getState().project;
  await click('Insert artwork');
  expect(useStore.getState().project.scene.objects).toHaveLength(6);
  expect(useStore.getState().undoStack).toEqual([source]);
  expect(onClose).toHaveBeenCalledOnce();
});

it('shows storage failure without claiming the entry was saved or changing the collection', async () => {
  vi.mocked(repository.add).mockRejectedValue(new Error('Storage quota exceeded'));
  await render();
  await input(0, 'Unsaved logo');
  await click('Save selection to My artwork');
  expect(records).toEqual([]);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Storage quota exceeded');
  expect(onClose).not.toHaveBeenCalled();
});

it('exports/imports the whole library and assigns fresh imported entry identities', async () => {
  const entry = await capturePersonalArtwork(useStore.getState(), 'Saved logo', 'Jigs');
  records = [entry];
  const write = vi.fn(async (_data: string | Blob) => undefined);
  await render({
    pickFileForSave: async () => ({ displayName: 'library.lfart', write }),
    pickFilesForOpen: async () => [
      { name: 'library.lfart', text: async () => serializePersonalArtworkLibrary([entry]) },
    ],
  });
  await click('Export library...');
  expect(parsePersonalArtworkLibrary(write.mock.calls[0]![0] as string)).toEqual([entry]);
  await click('Import library...');
  expect(records).toHaveLength(2);
  expect(records[1]?.id).not.toBe(entry.id);
  expect(records[1]?.projectJson).toBe(entry.projectJson);
});

it('closing the panel during file reading cancels import publication', async () => {
  const entry = await capturePersonalArtwork(useStore.getState(), 'Saved logo', '');
  let finish!: (value: string) => void;
  const text = new Promise<string>((resolve) => {
    finish = resolve;
  });
  await render({ pickFilesForOpen: async () => [{ name: 'late.lfart', text: () => text }] });
  await click('Import library...');
  await act(async () => root.render(null));
  await act(async () => finish(serializePersonalArtworkLibrary([entry])));
  expect(repository.add).not.toHaveBeenCalled();
  expect(records).toEqual([]);
});

it('cancelled file pickers and failed exports preserve local artwork and the open project', async () => {
  const entry = await capturePersonalArtwork(useStore.getState(), 'Saved logo', '');
  records = [entry];
  const project = useStore.getState().project;
  await render({ pickFilesForOpen: async () => [], pickFileForSave: async () => null });
  await click('Import library...');
  await click('Export library...');
  expect(records).toEqual([entry]);
  expect(useStore.getState().project).toBe(project);
  await render({
    pickFileForSave: async () => ({
      displayName: 'failed',
      write: async () => {
        throw new Error('Disk full');
      },
    }),
  });
  await click('Export library...');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Disk full');
  expect(records).toEqual([entry]);
});
