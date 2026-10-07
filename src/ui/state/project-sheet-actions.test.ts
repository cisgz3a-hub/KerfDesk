import { beforeEach, describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';
import { dependencyProject } from './testing/scene-clipboard-fixtures';

describe('named project sheets', () => {
  beforeEach(resetStore);
  it('round-trips independent sheet artwork and setup, with only the active scene compiled', () => {
    const original = {
      ...dependencyProject([svgObj('laser', ['#000000'])]),
      notes: 'Maple batch 2',
    };
    useStore.getState().setProject(original);
    useStore.setState({ savedName: 'batch.lf2', dirty: false });
    const originalEpoch = useStore.getState().projectDocumentEpoch;
    const id = useStore.getState().addProjectSheet('Router', false);
    expect(id).not.toBeNull();
    const active = useStore.getState().project;
    expect(active.scene.objects).toEqual([]);
    expect(useStore.getState().projectDocumentEpoch).toBe(originalEpoch + 1);
    expect(useStore.getState().savedName).toBe('batch.lf2');
    expect(useStore.getState().dirty).toBe(true);
    useStore.setState({
      project: { ...active, machine: DEFAULT_CNC_MACHINE_CONFIG, notes: 'Router setup' },
    });
    const saved = deserializeProject(serializeProject(useStore.getState().project));
    if (saved.kind !== 'ok') throw new Error('Expected all sheets to reopen');
    useStore.getState().setProject(saved.project);
    const firstId = saved.project.sheetBook?.inactive[0]?.id;
    if (firstId === undefined) throw new Error('Missing original sheet');
    expect(useStore.getState().switchProjectSheet(firstId)).toBe(true);
    const reopened = useStore.getState().project;
    const canonical = deserializeProject(serializeProject(original));
    if (canonical.kind !== 'ok') throw new Error('Expected canonical original');
    expect(reopened.scene.objects).toEqual(canonical.project.scene.objects);
    expect(reopened.notes).toBe('Maple batch 2');
    expect(reopened.machine?.kind ?? 'laser').toBe('laser');
    expect(compileJob(reopened.scene, reopened.device)).toEqual(
      compileJob(original.scene, original.device),
    );
    expect(useStore.getState().undoStack).toEqual([]);
    expect(useStore.getState().switchProjectSheet(id ?? '')).toBe(true);
    expect(useStore.getState().project.machine?.kind).toBe('cnc');
    expect(useStore.getState().project.notes).toBe('Router setup');
  });
  it('duplicates without nested books and makes metadata edits undoable', () => {
    useStore.getState().setProject(dependencyProject([svgObj('art', ['#000000'])]));
    const id = useStore.getState().addProjectSheet('Copy', true);
    if (id === null) throw new Error('Expected duplicate');
    const project = useStore.getState().project;
    const book = project.sheetBook;
    if (book === undefined || book.inactive[0] === undefined)
      throw new Error('Expected sheet book');
    expect(project.scene.objects[0]?.id).toBe('art');
    expect(JSON.parse(book.inactive[0].projectJson).sheetBook).toBeUndefined();
    useStore.getState().renameProjectSheet(id, 'Revised');
    expect(useStore.getState().project.sheetBook?.activeName).toBe('Revised');
    useStore.getState().undo();
    expect(useStore.getState().project.sheetBook?.activeName).toBe('Copy');
    const inactiveId = book.inactive[0].id;
    useStore.getState().deleteInactiveProjectSheet(id);
    expect(useStore.getState().project.sheetBook?.inactive).toHaveLength(1);
    useStore.getState().deleteInactiveProjectSheet(inactiveId);
    expect(useStore.getState().project.sheetBook?.inactive).toHaveLength(0);
    useStore.getState().undo();
    expect(useStore.getState().project.sheetBook?.inactive).toHaveLength(1);
  });
  it('rejects duplicate identities, nested books and unsupported archived schemas', () => {
    useStore.getState().setProject(dependencyProject([svgObj('art', ['#000000'])]));
    useStore.getState().addProjectSheet('Copy', true);
    const project = useStore.getState().project;
    const raw = JSON.parse(serializeProject(project));
    raw.sheetBook.inactive[0].id = raw.sheetBook.activeId;
    expect(deserializeProject(JSON.stringify(raw)).kind).not.toBe('ok');
    for (const schemaVersion of [undefined, 0, 99]) {
      const invalid = JSON.parse(serializeProject(project));
      const archive = JSON.parse(invalid.sheetBook.inactive[0].projectJson);
      archive.schemaVersion = schemaVersion;
      invalid.sheetBook.inactive[0].projectJson = JSON.stringify(archive);
      expect(deserializeProject(JSON.stringify(invalid)).kind).not.toBe('ok');
    }
    const nested = JSON.parse(serializeProject(project));
    nested.sheetBook.inactive[0].projectJson = serializeProject(project);
    expect(deserializeProject(JSON.stringify(nested)).kind).not.toBe('ok');
  });
});
