// Tools audit T1 (area T09) found four gaps in Leave white unburned (ADR-686
// Amendments 2 and 4), all on projects saved before the knock-out:
// - T09-P1-1: a logo whose fills are split by a stroke imports as several parts.
//   Copies drop `svgImport`, so each copied part was its own group and a copied
//   white had no darker fill: the copies kept burning their white while the
//   count, toast and notice said it was gone.
// - T09R-P1-1: a copy that also carries a Line cut was not "Fill", so it was
//   skipped and kept burning its white.
// - T09R-P1-2: an original whose operations were switched to Line was still
//   judged by its import mode, and its white score was turned into a cut.
// - T09-P2-1: a Line operation on a knocked part gained the hole outline, or
//   lost its white path and was deleted.
// ADR-686 Amendment 5 groups copies made together, judges every path by the
// Fill operations it burns through, and knocks out only those bindings.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { burnInside, importAsOlderBuild, whiteOutlines } from '../../__fixtures__/white-fill-burn';
import { countBurningImportedWhites } from '../../core/geometry/burning-imported-white';
import { compileJob } from '../../core/job/compile-job';
import { pathUsesOperation, type Project, type SceneObject } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { burningWhiteOpenNotice } from './saved-white-notice';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const DIAMOND = 'M20 10 L30 20 L20 30 L10 20 Z';
const svg = (content: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="60mm" viewBox="0 0 60 60">${content}</svg>`;
const SQUARE = '<rect x="5" y="5" width="30" height="30" fill="#000"/>';
const WHITE = `<path d="${DIAMOND}" fill="#fff"/>`;
/** A stroke between the fills splits the import into dark, line and white parts. */
const MULTI = svg(`${SQUARE}<line x1="0" y1="45" x2="40" y2="45" stroke="#00f"/>${WHITE}`);
const SINGLE = svg(`${SQUARE}${WHITE}`);
const SQUARE_EDGE = 120;
const DIAMOND_EDGE = 4 * Math.hypot(10, 10);

const store = () => useStore.getState();

function select(ids: ReadonlyArray<string>): void {
  useStore.setState({
    selectedObjectId: ids[0] ?? null,
    additionalSelectedIds: new Set(ids.slice(1)),
  });
}

const selectAll = () => select(store().project.scene.objects.map((object) => object.id));

/** Add operation on the selection, switched to Line: the operator's cut or score. */
function addLineOperation(ids: ReadonlyArray<string>, power: number): string {
  select(ids);
  const before = new Set(store().project.scene.layers.map((layer) => layer.id));
  store().addOperationForSelection();
  const added = store().project.scene.layers.find((layer) => !before.has(layer.id));
  if (added === undefined) throw new Error('no operation added');
  store().setLayerParam(added.id, { mode: 'line', power });
  return added.id;
}

function operationOf(color: string): string {
  const { scene } = store().project;
  for (const object of scene.objects) {
    if (!('paths' in object)) continue;
    for (const path of object.paths) {
      if (path.color !== color) continue;
      const layer = scene.layers.find((operation) => pathUsesOperation(object, path, operation));
      if (layer !== undefined) return layer.id;
    }
  }
  throw new Error(`no operation for ${color}`);
}

/** Compiled burn length of one operation. */
function operationLength(project: Project, operationId: string): number {
  let length = 0;
  for (const group of compileJob(project.scene, project.device).groups) {
    if (!('segments' in group) || group.layerId !== operationId) continue;
    for (const { polyline } of group.segments)
      for (let index = 1; index < polyline.length; index += 1)
        length += Math.hypot(
          polyline[index]!.x - polyline[index - 1]!.x,
          polyline[index]!.y - polyline[index - 1]!.y,
        );
  }
  return length;
}

function moveObjects(ids: ReadonlySet<string>, dx: number): void {
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects: state.project.scene.objects.map((object) =>
          ids.has(object.id)
            ? ({
                ...object,
                transform: { ...object.transform, x: object.transform.x + dx },
              } as SceneObject)
            : object,
        ),
      },
    },
  }));
}

const lastToast = () => useToastStore.getState().toasts.at(-1)?.message ?? '';

function openGolden(name: string): Project {
  const text = gunzipSync(
    readFileSync(resolve('src/__fixtures__/returning-user', `${name}.lf2.gz`)),
  ).toString('utf8');
  const result = deserializeProject(text);
  if (result.kind !== 'ok') throw new Error(`${name} did not open`);
  store().setProject(result.project);
  useStore.setState({ undoStack: [], redoStack: [] });
  return store().project;
}

beforeEach(resetStore);
afterEach(resetStore);

type CopyRoute = readonly [string, () => void];
const COPY_ROUTES: readonly CopyRoute[] = [
  [
    'Array ×3',
    () =>
      store().placeSelectionCopies([
        { dx: 0, dy: 0, rotationDeg: 0 },
        { dx: 60, dy: 0, rotationDeg: 0 },
        { dx: 120, dy: 0, rotationDeg: 0 },
      ]),
  ],
  [
    'Duplicate',
    () => {
      const before = new Set(store().project.scene.objects.map((object) => object.id));
      store().duplicateSelection();
      const copies = store().project.scene.objects.filter((object) => !before.has(object.id));
      moveObjects(new Set(copies.map((object) => object.id)), 80);
    },
  ],
  [
    'Paste',
    () => {
      const before = new Set(store().project.scene.objects.map((object) => object.id));
      store().copySelection();
      store().pasteClipboard();
      const copies = store().project.scene.objects.filter((object) => !before.has(object.id));
      moveObjects(new Set(copies.map((object) => object.id)), 80);
    },
  ],
];

describe('T09-P1-1: copies of a logo split into several parts', () => {
  it.each(COPY_ROUTES)('%s: every copy is counted and its white left unburned', (_route, copy) => {
    importAsOlderBuild(MULTI);
    expect(store().project.scene.objects).toHaveLength(3);
    selectAll();
    copy();
    const before = store().project;
    const logos = before.scene.objects.length / 3;
    expect(logos).toBeGreaterThan(1);
    const whites = whiteOutlines(before);
    expect(whites).toHaveLength(logos);
    expect(burnInside(before, whites)).toBeGreaterThan(logos * 1000);

    expect(countBurningImportedWhites(before.scene)).toBe(logos);
    expect(store().leaveSavedWhiteUnburned()).toBe(logos);
    const after = store().project;
    expect(whiteOutlines(after)).toEqual([]);
    expect(burnInside(after, whites)).toBeLessThan(1);
    expect(countBurningImportedWhites(after.scene)).toBe(0);
  });
});

describe('T09R-P1-1: copies that also carry a Line cut', () => {
  it('a Fill + Line copy is counted and knocked out, and its cut is unchanged', () => {
    importAsOlderBuild(SINGLE);
    const cut = addLineOperation([store().project.scene.objects[0]!.id], 100);
    selectAll();
    store().placeSelectionCopies([
      { dx: 0, dy: 0, rotationDeg: 0 },
      { dx: 45, dy: 0, rotationDeg: 0 },
    ]);
    const before = store().project;
    const whites = whiteOutlines(before);
    expect(whites).toHaveLength(2);
    const cutBefore = operationLength(before, cut);
    expect(cutBefore).toBeCloseTo(2 * (SQUARE_EDGE + DIAMOND_EDGE), 1);

    expect(countBurningImportedWhites(before.scene)).toBe(2);
    expect(store().leaveSavedWhiteUnburned()).toBe(2);
    const after = store().project;
    expect(burnInside(after, whites)).toBeLessThan(1);
    // The cut still follows the diamond: Line artwork is left alone.
    expect(operationLength(after, cut)).toBeCloseTo(cutBefore, 6);
  });

  it('the 1.0.29 copies golden with a Line cut added still counts all 4 logos', () => {
    openGolden('1.0.29-white-logo-copies');
    expect(countBurningImportedWhites(store().project.scene)).toBe(4);
    selectAll();
    const before = new Set(store().project.scene.layers.map((layer) => layer.id));
    store().addOperationForSelection();
    const cut = store().project.scene.layers.find((layer) => !before.has(layer.id))!.id;
    store().setLayerParam(cut, { mode: 'line', power: 100 });
    const project = store().project;
    const whites = whiteOutlines(project);
    const cutBefore = operationLength(project, cut);

    expect(countBurningImportedWhites(project.scene)).toBe(4);
    expect(store().leaveSavedWhiteUnburned()).toBe(4);
    const after = store().project;
    expect(burnInside(after, whites)).toBeLessThan(1);
    expect(operationLength(after, cut)).toBeCloseTo(cutBefore, 6);
  });
});

describe('T09R-P1-2: an original switched to Line is judged by its operations', () => {
  it('a black cut and a white score are not a white burning over a fill', () => {
    const older = importAsOlderBuild(SINGLE);
    const dark = operationOf('#000000');
    const white = operationOf('#ffffff');
    store().setLayerParam(dark, { mode: 'line', power: 100 });
    store().setLayerParam(white, { mode: 'line', power: 15 });
    const project = store().project;
    expect(project).not.toBe(older);
    expect(countBurningImportedWhites(project.scene)).toBe(0);
    expect(burningWhiteOpenNotice(project)).toBeNull();
    expect(store().leaveSavedWhiteUnburned()).toBe(0);
    expect(store().project).toBe(project);
    expect(operationLength(project, dark)).toBeCloseTo(SQUARE_EDGE, 1);
    expect(operationLength(project, white)).toBeCloseTo(DIAMOND_EDGE, 1);
  });

  it('the 1.0.29 logos golden: the switched logo leaves the count and keeps its score', () => {
    const golden = openGolden('1.0.29-white-logos');
    const counted = countBurningImportedWhites(golden.scene);
    expect(counted).toBe(5);
    const logo = golden.scene.objects.find((object) => object.id.endsWith('logo-0'));
    if (logo === undefined || !('paths' in logo)) throw new Error('no U3 logo');
    const layerOf = (index: number) =>
      golden.scene.layers.find((layer) => pathUsesOperation(logo, logo.paths[index]!, layer))!.id;
    const dark = layerOf(0);
    const white = layerOf(1);
    store().setLayerParam(dark, { mode: 'line', power: 100 });
    store().setLayerParam(white, { mode: 'line', power: 15 });
    const project = store().project;
    const cutBefore = operationLength(project, dark);
    const scoreBefore = operationLength(project, white);
    expect(scoreBefore).toBeGreaterThan(0);

    expect(countBurningImportedWhites(project.scene)).toBe(counted - 1);
    expect(store().leaveSavedWhiteUnburned()).toBe(counted - 1);
    const after = store().project;
    expect(operationLength(after, dark)).toBeCloseTo(cutBefore, 6);
    expect(after.scene.layers.some((layer) => layer.id === white)).toBe(true);
    expect(operationLength(after, white)).toBeCloseTo(scoreBefore, 6);
  });
});

describe('T09-P2-1: Line operations on a knocked part are left alone', () => {
  it('a cut on the dark part only does not gain the hole outline', () => {
    importAsOlderBuild(MULTI);
    const cut = addLineOperation([store().project.scene.objects[0]!.id], 77);
    const before = store().project;
    const whites = whiteOutlines(before);
    expect(operationLength(before, cut)).toBeCloseTo(SQUARE_EDGE, 1);

    expect(store().leaveSavedWhiteUnburned()).toBe(1);
    const after = store().project;
    expect(burnInside(after, whites)).toBeLessThan(1);
    expect(operationLength(after, cut)).toBeCloseTo(SQUARE_EDGE, 1);
  });

  it('a score on the white part only keeps its path and its operation', () => {
    importAsOlderBuild(MULTI);
    const whitePart = store().project.scene.objects[2]!.id;
    const whiteFill = operationOf('#ffffff');
    const score = addLineOperation([whitePart], 20);
    const before = store().project;
    const whites = whiteOutlines(before);
    expect(operationLength(before, score)).toBeCloseTo(DIAMOND_EDGE, 1);

    expect(store().leaveSavedWhiteUnburned()).toBe(1);
    const after = store().project;
    expect(burnInside(after, whites)).toBeLessThan(1);
    expect(after.scene.layers.some((layer) => layer.id === score)).toBe(true);
    expect(operationLength(after, score)).toBeCloseTo(DIAMOND_EDGE, 1);
    // Only the white's own Fill operation goes, and the toast names it.
    expect(after.scene.layers.some((layer) => layer.id === whiteFill)).toBe(false);
    const name = before.scene.layers.find((layer) => layer.id === whiteFill)!.name;
    expect(lastToast()).toContain(`“${name}”`);
    expect(countBurningImportedWhites(after.scene)).toBe(0);
  });
});
