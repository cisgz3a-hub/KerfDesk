// Rolling audit v9 R6-P1-1, R6-P1-2 and R6-P2-1: whether to keep a Studio
// drawing was guessed from what the opened project shared with it. An Apply
// on a new layer, or after an empty Apply, shared nothing with the older
// autosave a crash restored, and was written over. A drawing its saved file
// held took one of the five kept places from unapplied work, and New offered
// the previous project's saved drawing. The saved drawing now records whether
// a saved file or an autosave holds its Apply, and the project it came from
// (ADR-590 Amendment 3).
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { Sketch } from '../../core/design';
import { createDesignLayer } from '../../core/design/layers/design-layer';
import { createProject } from '../../core/scene';
import { readAutosave } from '../state/autosave';
import { useStore } from '../state';
import { readPersistedSession } from './design-session-storage';
import { readKeptDesignDrawings } from './design-kept-drawings';
import {
  applyInStudio,
  autosave,
  barText,
  closePage,
  ids,
  keptDrawingTestLifecycle,
  line,
  mount,
  one,
  open,
  openStudio,
  restart,
  restoreAutosave,
  roundTrip,
  save,
  studioSketch,
  three,
} from './design-kept-drawings.test-support';

keptDrawingTestLifecycle();

describe('an Apply only the Studio holds is kept after a crash (R6-P1-1)', () => {
  it('keeps three lines applied on a new layer after the autosave', async () => {
    await mount();
    await openStudio();
    await applyInStudio(one);
    const older = await autosave();
    expect(readPersistedSession()).toMatchObject({ projectHoldsApply: true, projectName: null });
    const layered: Sketch = {
      layers: [createDesignLayer('layer-2', 1)],
      entities: three.entities.map((entity) => ({ ...entity, layerId: 'layer-2' })),
    };
    await applyInStudio(layered);
    expect(readPersistedSession()).toMatchObject({ projectHoldsApply: false });

    await restart();
    await restoreAutosave(older);
    expect(ids(await openStudio())).toEqual(['applied']);
    expect(readKeptDesignDrawings().map((kept) => ids(kept.sketch))).toEqual([['n1', 'n2', 'n3']]);
    expect(await barText()).toContain(
      'A drawing applied to an untitled project that no saved file or autosave holds was kept: 3 shapes',
    );
  });

  it('keeps three lines applied after an empty Apply', async () => {
    await mount();
    await openStudio();
    await applyInStudio(one);
    const older = await autosave();
    await applyInStudio({ entities: [] });
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    await applyInStudio(three);

    await restart();
    await restoreAutosave(older);
    expect(ids(await openStudio())).toEqual(['applied']);
    expect(readKeptDesignDrawings().map((kept) => ids(kept.sketch))).toEqual([['n1', 'n2', 'n3']]);
  });

  it('keeps it when another project with its own drawing opens first', async () => {
    await mount();
    await openStudio();
    await applyInStudio(one);
    await autosave();
    await applyInStudio(three);
    const other = roundTrip(createProject());
    await restart();
    await open(
      {
        ...other,
        designStudioDocument: {
          version: 1,
          sketch: { entities: [line('other', 90)] },
          activeLayerId: 'design-layer-1',
          surface3d: false,
          appliedObjectIds: [],
          appliedOperationsByLayer: [],
          appliedEntityObjectIds: [],
        },
      },
      'Other.lf2',
    );
    expect(ids(await openStudio())).toEqual(['other']);
    expect(readKeptDesignDrawings().map((kept) => ids(kept.sketch))).toEqual([['n1', 'n2', 'n3']]);
  });

  it('does not keep an Apply its saved file holds when another project opens', async () => {
    await mount();
    await openStudio();
    await applyInStudio(three);
    await save('Bracket.lf2');
    expect(readPersistedSession()).toMatchObject({
      projectHoldsApply: true,
      projectName: 'Bracket.lf2',
    });
    await restart();
    await open(roundTrip(createProject()), 'Other.lf2');
    expect(await openStudio()).toEqual({ entities: [] });
    expect(readKeptDesignDrawings()).toEqual([]);
  });
});

describe('the web and desktop close paths', () => {
  it('web: the close autosave holds the Apply, so a restart offers nothing and Restore gives it back', async () => {
    await mount();
    useStore.setState({ dirty: true });
    await openStudio();
    await applyInStudio(three);
    await closePage();
    expect(readPersistedSession()).toMatchObject({ projectHoldsApply: true });
    const closed = readAutosave();
    if (closed === null) throw new Error('The close wrote no autosave');

    await restart();
    expect(await openStudio()).toEqual({ entities: [] });
    expect(readKeptDesignDrawings()).toEqual([]);
    await restoreAutosave(closed.project);
    expect(ids(studioSketch())).toEqual(['n1', 'n2', 'n3']);
  });

  it('desktop: Save at the close question holds the Apply, and the file gives it back', async () => {
    await mount();
    await openStudio();
    await applyInStudio(three);
    const file = await save('Bracket.lf2');
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(readPersistedSession()).toMatchObject({ projectHoldsApply: true });

    await restart();
    expect(await openStudio()).toEqual({ entities: [] });
    expect(readKeptDesignDrawings()).toEqual([]);
    await open(file, 'Bracket.lf2');
    expect(ids(studioSketch())).toEqual(['n1', 'n2', 'n3']);
  });
});
