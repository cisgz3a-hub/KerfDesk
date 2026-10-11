import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { studioDocument } from '../../io/project/studio-document.test-fixture';
import { createProject } from '../../core/scene';
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

function bind(): void {
  bindStudioSession({
    id: 'live',
    documentId: studioDocument().id,
    editor: 'vector',
    title: 'Artwork',
    running: true,
  });
}
it('captures native edits before archiving the current sheet on add and switch', async () => {
  bind();
  const native = studioDocument();
  vi.mocked(captureStudioDocument).mockResolvedValue(native);
  runProjectSheetChange(() => {
    useStore.getState().addProjectSheet('Next', false);
  });
  await vi.waitFor(() => expect(useStore.getState().project.sheetBook?.activeName).toBe('Next'));
  const original = useStore.getState().project.sheetBook!.inactive[0]!;
  expect(JSON.parse(original.projectJson).studioDocuments).toEqual([native]);
  bind();
  const latest = { ...native, title: 'Updated on next sheet' };
  vi.mocked(captureStudioDocument).mockResolvedValue(latest);
  runProjectSheetChange(() => {
    useStore.getState().switchProjectSheet(original.id);
  });
  await vi.waitFor(() => expect(useStore.getState().project.sheetBook?.activeId).toBe(original.id));
  expect(
    JSON.parse(useStore.getState().project.sheetBook!.inactive[0]!.projectJson).studioDocuments,
  ).toEqual([latest]);
});
it('keeps the active sheet when the native save fails', async () => {
  bind();
  const before = useStore.getState().project;
  vi.mocked(captureStudioDocument).mockRejectedValue(new Error('Native save failed'));
  const change = vi.fn();
  runProjectSheetChange(change);
  await vi.waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
  expect(change).not.toHaveBeenCalled();
  expect(useStore.getState().project).toBe(before);
});
it('discards a delayed sheet action after the project is replaced', async () => {
  bind();
  let finish!: (document: ReturnType<typeof studioDocument>) => void;
  vi.mocked(captureStudioDocument).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const change = vi.fn();
  runProjectSheetChange(change);
  await vi.waitFor(() => expect(captureStudioDocument).toHaveBeenCalled());
  useStore.getState().setProject(createProject());
  finish(studioDocument());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(change).not.toHaveBeenCalled();
  expect(useStore.getState().project.sheetBook).toBeUndefined();
});
