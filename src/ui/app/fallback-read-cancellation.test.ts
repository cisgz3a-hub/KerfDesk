import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mockPlatform, projectWithLine } from '../../__fixtures__/file-actions';
import { serializeProject } from '../../io/project';
import { openProjectCommand } from '../commands/open-project-command';
import { resetDocumentImportWorkerForTests } from '../import/document-import-worker-client';
import { resetImportWorkerForTests } from '../import/import-worker-client';
import { createMemoryRecentProjectStorage } from '../recent-projects/recent-project-storage';
import { configureRecentProjectsForTests } from '../recent-projects/recent-projects-store';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { dispatchImportFilesInOrder } from './import-dispatch';

const sources = {
  lf2: serializeProject({ ...projectWithLine(), notes: 'native opened' }),
  lbrn2:
    '<LightBurnProject><Shape Type="Rect" CutIndex="0" W="10" H="10"><XForm>1 0 0 1 20 20</XForm></Shape></LightBurnProject>',
  dxf: [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'LINE',
    '10',
    '0',
    '20',
    '0',
    '11',
    '10',
    '21',
    '0',
    '0',
    'ENDSEC',
    '0',
    'EOF',
    '',
  ].join('\n'),
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10"><path d="M0 0 L10 10" stroke="black" fill="none"/></svg>',
  plt: 'IN;SP1;PU0,0;PD400,0;PU;',
};

beforeEach(() => {
  resetStore();
  resetImportWorkerForTests();
  resetDocumentImportWorkerForTests();
  configureRecentProjectsForTests(createMemoryRecentProjectStorage());
  vi.stubGlobal('Worker', function () {
    throw new Error('workers unavailable');
  });
});
afterEach(() => {
  resetImportWorkerForTests();
  resetDocumentImportWorkerForTests();
  configureRecentProjectsForTests(null);
  vi.unstubAllGlobals();
});

it.each(['lf2', 'lbrn2', 'dxf', 'svg', 'plt'] as const)(
  'cancels %s after its fallback read; ordinary reads still succeed',
  async (kind) => {
    for (const cancel of [false, true]) {
      resetStore();
      let release!: (text: string) => void;
      const text = vi.fn(
        () =>
          new Promise<string>((resolve) => {
            release = resolve;
          }),
      );
      const pushToast = vi.fn();
      let pending: Promise<void>;
      if (kind === 'lf2' || kind === 'lbrn2') {
        pending = openProjectCommand(mockPlatform(), pushToast, {
          file: { name: `late.${kind}`, blob: async () => new Blob([sources[kind]]), text },
        });
      } else {
        const file = new File([sources[kind]], `part.${kind}`);
        Object.defineProperty(file, 'text', { value: text });
        const state = useStore.getState();
        pending = dispatchImportFilesInOrder(
          [file],
          {
            getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
            importSvgObject: state.importSvgObject,
            importSvgFragment: state.importSvgFragment,
            importRasterImage: state.importRasterImage,
            pushToast,
          },
          { sourceLabel: 'Drop' },
        );
      }
      await vi.waitFor(() => expect(text).toHaveBeenCalledOnce());
      if (cancel) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      release(sources[kind]);
      await pending;
      expect(useStore.getState().project.scene.objects).toHaveLength(cancel ? 0 : 1);
      if (cancel)
        expect(pushToast.mock.calls.some(([message]) => /cancelled/.test(message))).toBe(true);
    }
  },
);
