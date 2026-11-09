// Rolling audit v12 found that Leave white unburned (ADR-686 Amendment 2)
// missed copies, and that its count was looser than its knock-out:
// - X2-P1-1: Duplicate, Paste and Array copies drop `svgImport`, so a 1.0.29
//   logo's copies kept burning their white while the toast said it was gone.
// - X2-P3-2: an import whose white covers every darker shape, or whose darker
//   fill has Output off, was counted, and the button then did nothing useful.
// ADR-686 Amendment 4 counts and knocks out each copy on its own, and counts
// exactly what the knock-out leaves unburned.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  burnLength,
  importAsOlderBuild,
  importSvg,
  whiteOutlines,
} from '../../__fixtures__/white-fill-burn';
import { countBurningImportedWhites } from '../../core/geometry/burning-imported-white';
import type { Project } from '../../core/scene';
import { burningWhiteOpenNotice, burningWhiteReviewWarnings } from './saved-white-notice';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const DIAMOND = 'M14 20 L20 12 L26 20 L20 28 Z';
const svg = (content: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">${content}</svg>`;
const LOGO = svg(`<circle cx="20" cy="20" r="12" fill="#000"/><path d="${DIAMOND}" fill="#fff"/>`);

type CopyRoute = readonly [string, () => void];
const COPY_ROUTES: readonly CopyRoute[] = [
  [
    'Duplicate ×3',
    () => {
      for (let copy = 0; copy < 3; copy += 1) useStore.getState().duplicateSelection();
    },
  ],
  [
    'Paste ×3',
    () => {
      useStore.getState().copySelection();
      for (let copy = 0; copy < 3; copy += 1) useStore.getState().pasteClipboard();
    },
  ],
  [
    'Array ×3',
    () => {
      // The first placement is the selection itself.
      useStore.getState().placeSelectionCopies([
        { dx: 0, dy: 0, rotationDeg: 0 },
        { dx: 45, dy: 0, rotationDeg: 0 },
        { dx: 90, dy: 0, rotationDeg: 0 },
        { dx: 135, dy: 0, rotationDeg: 0 },
      ]);
    },
  ],
];

function selectFirst(): void {
  const first = useStore.getState().project.scene.objects[0];
  useStore.setState({ selectedObjectId: first?.id ?? null, additionalSelectedIds: new Set() });
}

/** Copies side by side, as an operator lays out a batch; stacked fills cancel. */
function spreadCopies(): Project {
  let next = 0;
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects: state.project.scene.objects.map((object, index) =>
          index === 0
            ? object
            : { ...object, transform: { ...object.transform, x: 70 + 45 * next++, y: 60 } },
        ),
      },
    },
  }));
  return useStore.getState().project;
}

function copiedLogos(route: CopyRoute[1], older: boolean): Project {
  if (older) importAsOlderBuild(LOGO);
  else importSvg(LOGO);
  selectFirst();
  route();
  return spreadCopies();
}

function setOutput(project: Project, operationIndex: number, output: boolean): Project {
  const operation = project.scene.layers[operationIndex];
  const next = {
    ...project,
    scene: {
      ...project.scene,
      layers: project.scene.layers.map((layer) =>
        layer.id === operation?.id ? { ...layer, output } : layer,
      ),
    },
  };
  useStore.setState({ project: next });
  return next;
}

beforeEach(resetStore);
afterEach(resetStore);

describe('X2-P1-1: copies of a logo saved before the knock-out', () => {
  it.each(COPY_ROUTES)('%s: every copy is counted and left unburned', (_route, copy) => {
    const fresh = burnLength(copiedLogos(copy, false));
    resetStore();
    const older = copiedLogos(copy, true);
    expect(older.scene.objects).toHaveLength(4);
    // The cause: these copies carry no import identity (scene-object-copy-dependencies.ts).
    expect(
      older.scene.objects.filter((object) => object.svgImport === undefined).length,
    ).toBeGreaterThanOrEqual(2);
    expect(countBurningImportedWhites(older.scene)).toBe(4);
    expect(burningWhiteOpenNotice(older)).toMatch(/^This project has 4 white shapes/);

    expect(useStore.getState().leaveSavedWhiteUnburned()).toBe(4);
    const knocked = useStore.getState().project;
    expect(whiteOutlines(knocked)).toEqual([]);
    // Each copy burns what a fresh import's copy burns: no white over the black.
    expect(burnLength(knocked)).toBeCloseTo(fresh, 6);
    expect(burningWhiteReviewWarnings(knocked)).toEqual([]);

    useStore.getState().undo();
    expect(burnLength(useStore.getState().project)).toBeCloseTo(burnLength(older), 6);
    expect(countBurningImportedWhites(useStore.getState().project.scene)).toBe(0);
  });

  it('leaves a copy on a Line operation alone: its white is a cut, not a fill', () => {
    importAsOlderBuild(LOGO);
    selectFirst();
    useStore.getState().duplicateSelection();
    const project = spreadCopies();
    const copy = project.scene.objects[1];
    if (copy === undefined || !('paths' in copy)) throw new Error('no copy');
    const line = project.scene.layers.map((layer) => ({ ...layer, id: `${layer.id}-line` }));
    const asLine: Project = {
      ...project,
      scene: {
        ...project.scene,
        layers: [
          ...project.scene.layers,
          ...line.map((layer) => ({ ...layer, mode: 'line' as const })),
        ],
        objects: project.scene.objects.map((object, index) =>
          index === 1 && 'paths' in object
            ? {
                ...object,
                paths: object.paths.map((path, pathIndex) => ({
                  ...path,
                  operationIds: [line[pathIndex]?.id ?? ''],
                })),
              }
            : object,
        ),
      },
    };
    expect(countBurningImportedWhites(asLine.scene)).toBe(1);
  });
});

describe('X2-P3-2: the count is what the button leaves unburned', () => {
  it('counts nothing when the darker fill has Output off, so only the white burns', () => {
    const older = importAsOlderBuild(LOGO);
    const darkOff = setOutput(older, 0, false);
    expect(countBurningImportedWhites(darkOff.scene)).toBe(0);
    expect(burningWhiteOpenNotice(darkOff)).toBeNull();
    expect(useStore.getState().leaveSavedWhiteUnburned()).toBe(0);
    expect(useStore.getState().project).toBe(darkOff);
  });

  it('counts nothing for an import whose white covers every darker shape', () => {
    importSvg(
      svg(
        '<rect x="10" y="10" width="20" height="20" fill="#000"/>' +
          '<rect x="5" y="5" width="30" height="30" fill="#fff"/>',
      ),
    );
    const project = useStore.getState().project;
    // The import itself left it as parsed (ADR-686 Decision 5).
    expect(whiteOutlines(project).length).toBeGreaterThan(0);
    expect(countBurningImportedWhites(project.scene)).toBe(0);
    expect(burningWhiteReviewWarnings(project)).toEqual([]);
  });
});
