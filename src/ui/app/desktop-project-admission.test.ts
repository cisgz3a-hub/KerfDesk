import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { serializeProject } from '../../io/project';
import { serializeProjectTemplate } from '../../io/project/project-template';
import type { FileHandle } from '../../platform/types';
import { setActiveEdition, UNRESTRICTED_EDITION, type EditionValue } from '../licensing/edition';
import {
  installProjectSealKey,
  resetProjectSealForTests,
  sealProjectText,
} from '../licensing/project-seal';
import { readLatestDurableAutosave } from '../state/autosave-durable-read';
import { AutosaveSessionLocks } from '../state/autosave-session-lock';
import { readAutosaveRecord, AUTOSAVE_SCHEMA_VERSION } from '../state/autosave-record';
import { usePendingProProjectStore } from '../state/pending-pro-project';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { completeNativeProjectOpen } from './project-open-completion';
import { parseOpenedProjectFile } from './project-open-parser';
import { openTemplateFile } from './project-template-actions';
import { proProject } from './pro-project-test-fixtures';

vi.mock('./autosave-file-cleanup', () => ({ clearAutosaveAfterFileHandoff: vi.fn() }));

const KEY = 'k'.repeat(43);
const requestPro = vi.fn(() => false);
const FREE: EditionValue = {
  status: null,
  licensed: true,
  pro: false,
  requestPro,
  openLicence: () => undefined,
};

beforeEach(() => {
  resetStore();
  usePendingProProjectStore.setState({ pending: null });
  setActiveEdition(FREE);
  resetProjectSealForTests(KEY);
  vi.clearAllMocks();
});
afterEach(() => {
  setActiveEdition(null);
  resetProjectSealForTests();
});

function context() {
  return {
    setProject: useStore.getState().setProject,
    markLoaded: vi.fn(useStore.getState().markLoaded),
    pushToast: vi.fn(),
  };
}

async function open(text: string): Promise<boolean> {
  const file = { name: 'signs.lf2', size: text.length, text: async () => text };
  const parsed = await parseOpenedProjectFile(file, {}, vi.fn());
  if (parsed.kind !== 'native') throw new Error('Expected a KerfDesk project.');
  return completeNativeProjectOpen(context(), 'signs.lf2', parsed.result);
}

it('opens Pro work in desktop Free only from text this computer sealed', async () => {
  const text = serializeProject(proProject());
  expect(await open(sealProjectText(text))).toBe(true);
  expect(usePendingProProjectStore.getState().pending).toBeNull();
});

it.each([
  ['a shared project with no seal', (text: string) => text],
  [
    'a hand-edited sealed project',
    (text: string) => sealProjectText(text).replace('"Editable logo"', '"Any lettering"'),
  ],
  [
    'a project sealed on another computer',
    (text: string) => {
      resetProjectSealForTests('o'.repeat(43));
      const sealed = sealProjectText(text);
      resetProjectSealForTests(KEY);
      return sealed;
    },
  ],
])('keeps %s out of desktop Free without changing the document', async (_name, prepare) => {
  const before = useStore.getState().project;
  expect(await open(prepare(serializeProject(proProject())))).toBe(false);
  expect(useStore.getState().project).toBe(before);
  expect(usePendingProProjectStore.getState().pending).toMatchObject({
    edition: 'desktop',
    features: ['vcarve'],
    name: 'signs.lf2',
  });
});

it('opens any Pro project while Pro is unlocked, and ordinary projects in Free', async () => {
  expect(await open(serializeProject(proProject({ cutType: 'profile-outside' })))).toBe(true);
  setActiveEdition(UNRESTRICTED_EDITION);
  expect(await open(serializeProject(proProject()))).toBe(true);
});

it('opens a Pro template in desktop Free only when this computer sealed it', async () => {
  const file = (text: string): FileHandle => ({ name: 'sign.lf2template', text: async () => text });
  await openTemplateFile(context(), file(serializeProjectTemplate(proProject())), () => true);
  expect(usePendingProProjectStore.getState().pending?.edition).toBe('desktop');
  usePendingProProjectStore.setState({ pending: null });
  await openTemplateFile(
    context(),
    file(serializeProjectTemplate(proProject(), sealProjectText)),
    () => true,
  );
  expect(usePendingProProjectStore.getState().pending).toBeNull();
  expect(
    useStore.getState().project.scene.layers.some((layer) => layer.id === 'pro-operation'),
  ).toBe(true);
});

it('restores a Pro autosave in desktop Free only when this computer sealed it', () => {
  const projectJson = serializeProject(proProject(), { compact: true });
  const read = (json: string) => {
    const result = readAutosaveRecord(
      { schemaVersion: AUTOSAVE_SCHEMA_VERSION, savedAt: 1, projectJson: json },
      'slot',
    );
    if (result.kind !== 'ok') throw new Error(result.kind);
    return useStore.getState().setProject(result.snapshot.project).kind;
  };
  expect(read(projectJson)).toBe('desktop-required');
  expect(read(sealProjectText(projectJson))).toBe('loaded');
});

it('waits for the protected key before classifying an autosave at startup', async () => {
  const projectJson = sealProjectText(serializeProject(proProject(), { compact: true }));
  resetProjectSealForTests();
  let resolveKey!: (key: string) => void;
  installProjectSealKey(() => new Promise((resolve) => (resolveKey = resolve)));
  const storageKey = 'lf2:autosave:v1';
  localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 1, savedAt: 1, projectJson }));
  const readAllSlots = vi.fn(async () => []);
  const pending = readLatestDurableAutosave(
    {
      readAllSlots,
      readEpoch: vi.fn(),
      holdsReplaceableSnapshot: vi.fn(),
      commit: vi.fn(),
      clear: vi.fn(),
    },
    new AutosaveSessionLocks(null),
    'current-session',
  );
  try {
    await Promise.resolve();
    expect(readAllSlots).not.toHaveBeenCalled();
    resolveKey(KEY);
    const read = await pending;
    expect(read.snapshot).not.toBeNull();
    expect(useStore.getState().setProject(read.snapshot!.project).kind).toBe('loaded');
  } finally {
    localStorage.removeItem(storageKey);
  }
});
