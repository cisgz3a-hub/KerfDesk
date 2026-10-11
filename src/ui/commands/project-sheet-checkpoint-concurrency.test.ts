import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { studioDocument } from '../../io/project/studio-document.test-fixture';
import { captureStudioDocument } from '../artcraft-studio/artcraft-api';
import {
  bindStudioSession,
  disposeStudioProjectBridge,
} from '../artcraft-studio/studio-project-bridge';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { runProjectSheetChange } from './project-sheet-checkpoint';

vi.mock('../artcraft-studio/artcraft-api', () => ({ captureStudioDocument: vi.fn() }));

beforeEach(() => {
  resetStore();
  vi.mocked(captureStudioDocument).mockReset();
});
afterEach(() => {
  disposeStudioProjectBridge();
  useToastStore.setState({ toasts: [] });
});

it('duplicates the latest checkpoint and metadata once when sheet requests overlap', async () => {
  const native = studioDocument();
  bindStudioSession({
    id: 'live',
    documentId: native.id,
    editor: 'vector',
    title: 'Artwork',
    running: true,
  });
  let finish!: (document: ReturnType<typeof studioDocument>) => void;
  vi.mocked(captureStudioDocument).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = vi.fn(() => useStore.getState().addProjectSheet('Copy', true));
  const second = vi.fn(() => useStore.getState().addProjectSheet('Unwanted extra', false));
  runProjectSheetChange(first);
  runProjectSheetChange(second);
  await vi.waitFor(() => expect(captureStudioDocument).toHaveBeenCalledTimes(1));
  useStore.getState().renameProjectSheet('current', 'Original renamed during capture');
  const latest = { ...native, title: 'Newest native artwork' };
  finish(latest);
  await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1));
  expect(second).not.toHaveBeenCalled();
  const project = useStore.getState().project;
  expect(project.studioDocuments).toEqual([latest]);
  expect(project.sheetBook?.activeName).toBe('Copy');
  expect(project.sheetBook?.inactive).toHaveLength(1);
  const original = project.sheetBook!.inactive[0]!;
  expect(original.name).toBe('Original renamed during capture');
  expect(JSON.parse(original.projectJson).studioDocuments).toEqual([latest]);
});

it('allows a new sheet request after a rejected checkpoint', async () => {
  const native = studioDocument();
  bindStudioSession({
    id: 'live',
    documentId: native.id,
    editor: 'vector',
    title: 'Artwork',
    running: true,
  });
  vi.mocked(captureStudioDocument).mockRejectedValueOnce(new Error('Try again'));
  const rejected = vi.fn();
  runProjectSheetChange(rejected);
  await vi.waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
  expect(rejected).not.toHaveBeenCalled();
  vi.mocked(captureStudioDocument).mockResolvedValue(native);
  runProjectSheetChange(() => {
    useStore.getState().addProjectSheet('Retry', false);
  });
  await vi.waitFor(() => expect(useStore.getState().project.sheetBook?.activeName).toBe('Retry'));
  expect(captureStudioDocument).toHaveBeenCalledTimes(2);
});
