import { afterEach, expect, it } from 'vitest';
import { studioDocument } from '../../io/project/studio-document.test-fixture';
import { validateProjectStudioDocuments } from '../../io/project/project-studio-document-validator';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

afterEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});
it('refuses a duplicate that fits the sheet archive limit but exceeds the aggregate native budget', () => {
  resetStore();
  // Two 16.5 MiB sources fit a single archive, but copying them exceeds 64 MiB.
  const nativeBase64 = 'A'.repeat(22 * 1024 * 1024);
  const studioDocuments = [1, 2].map((id) =>
    studioDocument({
      id: `11111111-1111-4111-8111-${String(id).padStart(12, '0')}`,
      nativeBase64,
    }),
  );
  useStore.setState((state) => ({ project: { ...state.project, studioDocuments } }));
  const before = useStore.getState();
  expect(validateProjectStudioDocuments(before.project)).toBeNull();
  expect(before.addProjectSheet('Oversized copy', true)).toBeNull();
  expect(useStore.getState().project).toBe(before.project);
  expect(useStore.getState().projectDocumentEpoch).toBe(before.projectDocumentEpoch);
  expect(useStore.getState().undoStack).toBe(before.undoStack);
  expect(useToastStore.getState().toasts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('64 MiB') }),
    ]),
  );
});
