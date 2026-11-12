// Every reader of a saved project says what its load changed, the same way
// (ADR-673 Amendment 1, rolling audit v4 H7-P1-2 and H7-P3-1): a photo an
// earlier build kept behind its trace now has Output off, a project from an
// older schema was migrated, and a refused Auto-focus command was removed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compileJob } from '../../core/job';
import { createProject } from '../../core/scene';
import { legacyTraceDocument } from '../../__fixtures__/legacy-trace-source-project';
import { deserializeProject, serializeProject } from '../../io/project';
import type { FileHandle } from '../../platform/types';
import { loadedMachineCapabilityWarningMessage } from '../machine/machine-capability-messages';
import { readAutosaveRecord } from '../state/autosave-record';
import { useNoticeHistory } from '../state/notice-history';
import { keptTracePhotosMessage, PROJECT_NOTICES_TOAST_KEY } from '../state/project-load-notices';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { completeNativeProjectOpen } from './project-open-completion';
import { openTemplateFile } from './project-template-actions';

const KEPT_PHOTO = [keptTracePhotosMessage(1), 'warning'];
const AUTOFOCUS_REMOVED =
  'The saved Auto-focus command was removed because it is not supported. Review Auto-focus in Machine Settings before using it.';
// One toast for the whole load: its result, then its notes, one a line (ADR-708).
const SLOT = { key: PROJECT_NOTICES_TOAST_KEY };
const lines = (...text: ReadonlyArray<string>): string => text.join('\n');

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

function context() {
  const state = useStore.getState();
  return { setProject: state.setProject, markLoaded: state.markLoaded, pushToast: vi.fn() };
}

function templateFile(projectJson: string): FileHandle {
  const text = `${JSON.stringify({ format: 'kerfdesk-project-template', version: 1, projectJson })}\n`;
  return {
    name: 'sign.lf2template',
    size: text.length,
    text: async () => text,
    blob: async () => new Blob([text]),
  } as FileHandle;
}

// A v16 file whose Auto-focus command this build refuses.
function olderFileWithRefusedFocus(): string {
  const project = createProject();
  const json = JSON.parse(
    serializeProject({ ...project, device: { ...project.device, autofocusCommand: 'G38.2 Z-10' } }),
  ) as Record<string, unknown>;
  json['schemaVersion'] = 16;
  return JSON.stringify(json);
}

function jobKinds(): string[] {
  const { project } = useStore.getState();
  return compileJob(project.scene, project.device).groups.map((group) => group.kind);
}

describe('a photo kept behind its trace by an earlier build', () => {
  it('File > Open says it is now off, and the job stays trace-only', () => {
    const ctx = context();
    const opened = completeNativeProjectOpen(
      ctx,
      'sign.lf2',
      deserializeProject(legacyTraceDocument()),
    );

    expect(opened).toBe(true);
    expect(ctx.pushToast.mock.calls).toEqual([
      [lines('Opened sign.lf2', keptTracePhotosMessage(1)), 'warning', SLOT],
    ]);
    expect(jobKinds()).toEqual(['cut']);
  });

  it('New from template says the same', async () => {
    const ctx = context();
    await openTemplateFile(ctx, templateFile(legacyTraceDocument()), () => true);

    expect(ctx.pushToast.mock.calls).toEqual([
      [
        lines(
          'Started a new project from sign.lf2template. Save will ask for a destination.',
          keptTracePhotosMessage(1),
        ),
        'warning',
        SLOT,
      ],
    ]);
    expect(jobKinds()).toEqual(['cut']);
  });

  it('an autosave record carries the notice for Restore', () => {
    const read = readAutosaveRecord(
      { schemaVersion: 1, savedAt: 1, projectJson: legacyTraceDocument() },
      'lf2:autosave:v1:test',
    );
    if (read.kind !== 'ok') throw new Error(read.kind);
    expect(read.snapshot.loadNotices).toEqual({ keptTracePhotosOff: 1 });
  });

  it('switching to a sheet an earlier build archived says the same', () => {
    useStore.getState().setProject({
      ...createProject(),
      sheetBook: {
        activeId: 'current',
        activeName: 'Sheet 1',
        inactive: [{ id: 'portrait', name: 'Portrait', projectJson: legacyTraceDocument() }],
      },
    });
    useToastStore.setState({ toasts: [] });

    expect(useStore.getState().switchProjectSheet('portrait')).toBe(true);
    expect(useToastStore.getState().toasts.map((toast) => [toast.message, toast.variant])).toEqual([
      KEPT_PHOTO,
    ]);
    expect(jobKinds()).toEqual(['cut']);
  });
});

// Annoyance audit A5-P2-6: each note was its own toast, only three toasts
// show, and the first were pushed out unseen.
describe('a project that opens with several notes', () => {
  it('says them on one toast under "Opened", and keeps them in the notice history', () => {
    useNoticeHistory.getState().clearNotices();
    const state = useStore.getState();
    const opened = completeNativeProjectOpen(
      {
        // The machine could not take the saved machine kind: one more note.
        setProject: (project) => {
          state.setProject(project);
          return { kind: 'capability-warning', activeKind: 'laser' };
        },
        markLoaded: state.markLoaded,
        pushToast: useToastStore.getState().pushToast,
      },
      'old.lf2',
      {
        kind: 'ok',
        project: createProject(),
        migratedFrom: 12,
        autofocusCommandRemoved: true,
        keptTracePhotosOff: 2,
      },
    );

    expect(opened).toBe(true);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    const [toast] = toasts;
    expect(toast).toMatchObject({ variant: 'warning', key: PROJECT_NOTICES_TOAST_KEY });
    expect(toast?.message.split('\n')).toEqual([
      'Opened old.lf2 — migrated from schema v12',
      AUTOFOCUS_REMOVED,
      keptTracePhotosMessage(2),
      loadedMachineCapabilityWarningMessage('laser'),
    ]);
    expect(useNoticeHistory.getState().notices.map((notice) => notice.message)).toEqual([
      toast?.message,
    ]);
  });

  it('opening the next project rewrites that toast instead of stacking another', () => {
    const state = useStore.getState();
    const ctx = {
      setProject: state.setProject,
      markLoaded: state.markLoaded,
      pushToast: useToastStore.getState().pushToast,
    };
    completeNativeProjectOpen(ctx, 'first.lf2', {
      kind: 'ok',
      project: createProject(),
      autofocusCommandRemoved: true,
    });
    completeNativeProjectOpen(ctx, 'second.lf2', { kind: 'ok', project: createProject() });

    expect(useToastStore.getState().toasts.map((toast) => [toast.message, toast.variant])).toEqual([
      ['Opened second.lf2', 'success'],
    ]);
  });
});

describe('the notices File > Open gives reach the other readers (H7-P3-1)', () => {
  it('New from template names the migration and the removed Auto-focus command', async () => {
    const ctx = context();
    await openTemplateFile(ctx, templateFile(olderFileWithRefusedFocus()), () => true);

    expect(ctx.pushToast.mock.calls).toEqual([
      [
        lines(
          'Started a new project from sign.lf2template. Save will ask for a destination.',
          'This project was saved by an earlier KerfDesk and was migrated from schema v16.',
          AUTOFOCUS_REMOVED,
        ),
        'warning',
        SLOT,
      ],
    ]);
  });

  it('an autosave record carries both for Restore', () => {
    const read = readAutosaveRecord(
      { schemaVersion: 1, savedAt: 1, projectJson: olderFileWithRefusedFocus() },
      'lf2:autosave:v1:test',
    );
    if (read.kind !== 'ok') throw new Error(read.kind);
    expect(read.snapshot.loadNotices).toEqual({ migratedFrom: 16, autofocusCommandRemoved: true });
  });

  it('a current project carries none', () => {
    const read = readAutosaveRecord(
      { schemaVersion: 1, savedAt: 1, projectJson: serializeProject(createProject()) },
      'lf2:autosave:v1:test',
    );
    if (read.kind !== 'ok') throw new Error(read.kind);
    expect(read.snapshot).not.toHaveProperty('loadNotices');
  });
});
