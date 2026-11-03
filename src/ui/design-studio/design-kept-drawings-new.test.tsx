// Rolling audit v9 R6-P1-2 and R6-P2-1: a drawing its saved file held took
// one of the five kept places from unapplied work, File > New offered the
// previous project's saved drawing without naming it, and a Discard came back.
// Kept drawings are now decided by whether a copy on disk holds the Apply, and
// name their project (ADR-590 Amendment 3).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { useStore } from '../state';
import { svgObj } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import {
  discardKeptDesignDrawing,
  keepDesignDrawing,
  readKeptDesignDrawings,
} from './design-kept-drawings';
import { useDesignStudioStore } from './design-studio-store';
import {
  applyInStudio,
  barText,
  fileNew,
  ids,
  keptDrawingTestLifecycle,
  line,
  mount,
  one,
  open,
  openStudio,
  restoreAutosave,
  save,
  three,
} from './design-kept-drawings.test-support';

keptDrawingTestLifecycle();

describe('File > New (R6-P1-2, R6-P2-1)', () => {
  /** A drawing never applied, set aside by File > New. */
  async function keepUnappliedWork(): Promise<void> {
    await act(async () => {
      useStore.getState().importSvgObject(svgObj('svg-a', ['#000000']));
      await vi.runAllTimersAsync();
    });
    await save('Unapplied.lf2');
    await openStudio();
    await act(async () => {
      useDesignStudioStore.getState().setSketch({ entities: [line('u1', 100)] });
      await vi.runAllTimersAsync();
    });
    await fileNew();
    await openStudio();
  }

  it('keeps unapplied work through five saved Studio projects', async () => {
    await mount();
    await keepUnappliedWork();
    expect(readKeptDesignDrawings().map((kept) => ids(kept.sketch))).toEqual([['u1']]);
    for (let index = 1; index <= 5; index++) {
      await applyInStudio({ entities: [line(`p${index}`, index * 10)] });
      await save(`P${index}.lf2`);
      await fileNew();
      await openStudio();
    }
    expect(readKeptDesignDrawings().map((kept) => ids(kept.sketch))).toEqual([['u1']]);
    expect(await barText()).toContain(
      'A drawing you had not applied, from "Unapplied.lf2", was kept: 1 shape',
    );
  });

  it('offers nothing after New when the Studio drew and saved, or was not used', async () => {
    await mount();
    await openStudio();
    await applyInStudio(three);
    await save('Bracket.lf2');
    await fileNew();
    expect(await openStudio()).toEqual({ entities: [] });
    expect(readKeptDesignDrawings()).toEqual([]);
    expect(await barText()).toBe('');

    await fileNew();
    expect(await openStudio()).toEqual({ entities: [] });
    expect(readKeptDesignDrawings()).toEqual([]);
  });

  it('offers an Apply no copy holds after New, naming its project', async () => {
    await mount();
    await openStudio();
    await applyInStudio(one);
    await save('Bracket.lf2');
    await applyInStudio({ entities: [...one.entities, ...three.entities] });
    await fileNew();
    await openStudio();
    expect(await barText()).toContain(
      'A drawing applied to "Bracket.lf2" that no saved file or autosave holds was kept: 4 shapes',
    );
  });

  it('keeps a discard after its file opens in the Studio and is left again', async () => {
    await mount();
    await openStudio();
    await applyInStudio(one);
    const file = await save('Bracket.lf2');
    await applyInStudio({ entities: [...one.entities, ...three.entities] });
    await fileNew();
    await openStudio();
    const kept = readKeptDesignDrawings();
    expect(kept).toHaveLength(1);
    // The bar's Discard, once confirmed.
    await act(async () => discardKeptDesignDrawing(kept[0]!.id));
    expect(readKeptDesignDrawings()).toEqual([]);

    await open(file, 'Bracket.lf2');
    expect(ids(await openStudio())).toEqual(['applied']);
    await fileNew();
    await openStudio();
    expect(readKeptDesignDrawings()).toEqual([]);
    expect(await barText()).toBe('');
  });
});

describe('the five kept places (R6-P1-2)', () => {
  const draft = (id: string, extra: object = {}) => ({
    sketch: { entities: [line(id, 0)] },
    activeLayerId: 'layer-1',
    surface3d: false,
    applied: null,
    projectName: `${id}.lf2`,
    ...extra,
  });

  it('drops an applied drawing a copy may hold before unapplied work, and says so', () => {
    keepDesignDrawing(draft('old-applied', { dirtySinceApply: false }), 1000);
    for (let index = 0; index < 4; index++) keepDesignDrawing(draft(`u${index}`), 2000 + index);
    keepDesignDrawing(draft('newest'), 3000);
    expect(readKeptDesignDrawings().map((kept) => ids(kept.sketch)[0])).toEqual([
      'newest',
      'u3',
      'u2',
      'u1',
      'u0',
    ]);
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      expect.stringContaining(
        'Design Studio keeps 5 drawings, so one was dropped to keep this one: 1 shape from "old-applied.lf2", kept',
      ),
    ]);
  });

  it('drops the oldest unapplied drawing past five, and says so', () => {
    for (let index = 0; index < 6; index++) keepDesignDrawing(draft(`u${index}`), 1000 + index);
    expect(readKeptDesignDrawings().map((kept) => ids(kept.sketch)[0])).toEqual([
      'u5',
      'u4',
      'u3',
      'u2',
      'u1',
    ]);
    expect(useToastStore.getState().toasts[0]?.message).toContain('from "u0.lf2"');
  });
});

// Saved by the real 1.0.28 code (src/__fixtures__/returning-user/README.md):
// its saved drawing and kept drawing record neither a source nor a copy.
describe('a Studio session and kept drawing saved by 1.0.28', () => {
  const FOLDER = 'src/__fixtures__/returning-user';
  const storage = JSON.parse(readFileSync(resolve(FOLDER, '1.0.28-studio-storage.json'), 'utf8'));
  const project = (name: string): Project => {
    const opened = deserializeProject(readFileSync(resolve(FOLDER, name), 'utf8'));
    if (opened.kind !== 'ok') throw new Error(`${name} did not open`);
    return opened.project;
  };
  function load1028(): void {
    localStorage.setItem('laserforge.design-studio-session.v1', JSON.stringify(storage.session));
    localStorage.setItem('laserforge.design-studio-kept-drawings.v1', JSON.stringify(storage.kept));
  }

  it('opens the newer file on its drawing and keeps only the unapplied one', async () => {
    load1028();
    await mount();
    await open(project('1.0.28-studio-newer.lf2'), 'Studio.lf2');
    expect(ids(await openStudio())).toEqual(['applied', 'l1', 'l2']);
    expect(readKeptDesignDrawings().map((kept) => ids(kept.sketch))).toEqual([['u1', 'u2']]);
    expect(await barText()).toContain('A drawing you had not applied was kept: 2 shapes');
  });

  it('offers the applied drawing on the older autosave, as 1.0.28 did not', async () => {
    load1028();
    await mount();
    await restoreAutosave(project('1.0.28-studio-older.lf2'));
    expect(ids(await openStudio())).toEqual(['applied']);
    expect(readKeptDesignDrawings().map((kept) => ids(kept.sketch))).toEqual([
      ['applied', 'l1', 'l2'],
      ['u1', 'u2'],
    ]);
    expect(await barText()).toContain(
      'An applied drawing this project does not hold was kept: 3 shapes',
    );
  });
});
