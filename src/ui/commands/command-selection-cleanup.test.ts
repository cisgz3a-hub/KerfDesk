import { describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
  type RasterImage,
  type SceneGroup,
  type SceneObject,
} from '../../core/scene';
import { buildAppCommands, commandById, runCommand } from './command-registry';
import { baseCtx } from './command-registry-test-helpers';
import { selectionCanCombine, selectionCanDeleteDuplicates } from './selection-command-state';

describe('selection cleanup commands (ADR-377)', () => {
  it('offers Delete Duplicates on Alt+D only when there is vector artwork to check', () => {
    const deleteDuplicates = vi.fn();
    const off = commandById(
      buildAppCommands(baseCtx({ canDeleteDuplicates: false, deleteDuplicates })),
      'edit.delete-duplicates',
    );
    expect(off.enabled).toBe(false);
    expect(runCommand(off)).toBe(false);

    const whole = commandById(
      buildAppCommands(baseCtx({ canDeleteDuplicates: true, deleteDuplicates })),
      'edit.delete-duplicates',
    );
    expect(whole).toMatchObject({ label: 'Delete Duplicates', shortcut: 'Alt+D', enabled: true });
    expect(whole.title).toContain('in the selection or the whole design');
    expect(runCommand(whole)).toBe(true);
    expect(deleteDuplicates).toHaveBeenCalledTimes(1);
  });

  it('offers Rubber-band outline under Tools whenever something is selected', () => {
    const createRubberBandOutline = vi.fn();
    const off = commandById(
      buildAppCommands(baseCtx({ hasSelection: false, createRubberBandOutline })),
      'tools.rubber-band-outline',
    );
    const on = commandById(
      buildAppCommands(baseCtx({ hasSelection: true, createRubberBandOutline })),
      'tools.rubber-band-outline',
    );

    expect(off.enabled).toBe(false);
    expect(on).toMatchObject({ family: 'tools', enabled: true });
    expect(runCommand(on)).toBe(true);
    expect(createRubberBandOutline).toHaveBeenCalledTimes(1);
  });
});

describe('selection state for the cleanup and Boolean commands', () => {
  it('counts a selected group as one Boolean operand', () => {
    const group: SceneGroup = { id: 'g', name: 'Group 1', objectIds: ['outer', 'inner'] };
    const project = projectWith(
      [square('outer', 0, 30), square('inner', 10, 10), square('other', 40, 10)],
      [group],
    );

    expect(selectionCanCombine(project, ['outer', 'inner'])).toBe(false);
    expect(selectionCanCombine(project, ['outer', 'inner', 'other'])).toBe(true);
  });

  it('checks the selection, or the whole design when nothing is selected, for duplicates', () => {
    const project = projectWith([
      square('a', 0, 10),
      { ...square('locked', 0, 10), locked: true },
      image('photo'),
    ]);

    expect(selectionCanDeleteDuplicates(project, [])).toBe(true);
    expect(selectionCanDeleteDuplicates(project, ['locked', 'photo'])).toBe(false);
    expect(selectionCanDeleteDuplicates(projectWith([image('photo')]), [])).toBe(false);
  });
});

function projectWith(
  objects: ReadonlyArray<SceneObject>,
  groups: ReadonlyArray<SceneGroup> = [],
): Project {
  return {
    ...createProject(),
    scene: {
      objects: [...objects],
      layers: [createLayer({ id: 'cut', color: '#000000' })],
      groups,
    },
  };
}

function square(id: string, origin: number, size: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: origin, minY: origin, maxX: origin + size, maxY: origin + size },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: origin, y: origin },
              { x: origin + size, y: origin },
              { x: origin + size, y: origin + size },
              { x: origin, y: origin + size },
            ],
          },
        ],
      },
    ],
  };
}

function image(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    pixelWidth: 10,
    pixelHeight: 10,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#333333',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  } as unknown as RasterImage;
}
