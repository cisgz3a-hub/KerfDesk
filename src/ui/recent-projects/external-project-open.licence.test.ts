import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { serializeProject } from '../../io/project';
import type { ExternalFileOpenRequest, ExternalFileOpenSource } from '../../platform/types';
import { mockPlatform, projectWithLine, toasts } from '../../__fixtures__/file-actions';
import { useStore } from '../state';
import { clearAutosave } from '../state/autosave';
import { subscribeExternalProjectOpens } from './external-project-open';
import { createMemoryRecentProjectStorage } from './recent-project-storage';
import { configureRecentProjectsForTests } from './recent-projects-store';

// The first licence status, held open by each test until it chooses to settle it.
const licence = vi.hoisted(() => {
  let settle: () => void = () => undefined;
  return {
    reset: () => new Promise<void>((resolve) => (settle = resolve)),
    settle: () => settle(),
  };
});
let firstStatus = licence.reset();
vi.mock('../licensing/edition', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  initialLicenceStatus: () => firstStatus,
}));

beforeEach(() => {
  firstStatus = licence.reset();
  configureRecentProjectsForTests(createMemoryRecentProjectStorage());
  useStore.getState().newProject();
  useStore.setState({ dirty: false, projectOpenRequestEpoch: 0 });
});

afterEach(() => {
  clearAutosave();
  configureRecentProjectsForTests(null);
  useStore.getState().newProject();
  useStore.setState({ dirty: false });
});

it('waits for the first licence status before opening a file handed over at launch', async () => {
  // ADR-623 Amendment 3: the workspace mounts before the licence status, while
  // Pro is still locked for startup (ADR-592). A file opened from Explorer at a
  // cold launch must be judged against the real licence, as autosave recovery is.
  let emit: (request: ExternalFileOpenRequest) => void = () => undefined;
  const source: ExternalFileOpenSource = {
    subscribe: (listener) => {
      emit = listener;
      return () => undefined;
    },
  };
  const text = serializeProject({ ...projectWithLine(), notes: 'opened at launch' });
  const cleanup = subscribeExternalProjectOpens(source, {
    platform: mockPlatform(),
    pushToast: toasts().pushToast,
    jobActive: () => false,
    dialogOpen: () => false,
  });
  emit({ kind: 'file', file: { name: 'launch.lf2', text: async () => text } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(useStore.getState().savedName).toBeNull();
  licence.settle();
  await vi.waitFor(() => expect(useStore.getState().savedName).toBe('launch.lf2'));
  cleanup();
});
