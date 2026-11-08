// Rolling audit v10 found three gaps in the white-fill knock-out (ADR-686):
// - V7-P2-1: see-through, gradient and masked white were cut out as paper; a
//   blue gradient emblem vanished, and the toast said "as in the file".
// - V7-P2-2: re-importing an unchanged knocked-out logo reset its operations to
//   the starter values (77 % / 3 passes became 30 % / 1 pass).
// - V2-P2-1: a logo imported before the knock-out keeps burning its white, and
//   nothing says so. Opening never changes the burn; Leave white unburned does,
//   as one Undo step.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  burnInside,
  burnLength,
  importSvg,
  whiteOutlines,
} from '../../__fixtures__/white-fill-burn';
import { countBurningImportedWhites } from '../../core/geometry/burning-imported-white';
import type { Project, SceneObject } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { prepareProjectForPersistence } from '../../io/project/prepare-project-persistence';
import { parseSvg } from '../../io/svg/parse-svg';
import { describeSvgImport } from '../app/svg-import-action';
import { completeNativeProjectOpen } from '../app/project-open-completion';
import { burningWhiteOpenNotice, burningWhiteReviewWarnings } from './saved-white-notice';
import { reviewNoteRank } from '../laser/review-note-rank';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const DIAMOND = 'M14 20 L20 12 L26 20 L20 28 Z';
const svg = (content: string, size = 40) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}mm" height="40mm" viewBox="0 0 ${size} 40">${content}</svg>`;
const badge = (white: string, defs = '') =>
  svg(
    `${defs}<rect x="2" y="2" width="36" height="36" fill="#000"/><path d="${DIAMOND}" ${white}/>`,
  );
const GRADIENT = (first: string, second: string) =>
  `<defs><radialGradient id="g"><stop offset="0" stop-color="${first}"/>` +
  `<stop offset="1" stop-color="${second}"/></radialGradient></defs>`;
// V7's logo: a gradient emblem beside a black bar, nothing overlapping.
const emblem = (first: string, second: string) =>
  svg(
    `${GRADIENT(first, second)}<circle cx="20" cy="20" r="14" fill="url(#g)"/>` +
      '<rect x="42" y="14" width="34" height="12" fill="#000"/>',
    80,
  );

const objectPaths = (project: Project) =>
  project.scene.objects.flatMap((object) => ('paths' in object ? object.paths : []));

function tuneEveryOperation(power: number, passes: number): void {
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        layers: state.project.scene.layers.map((layer) => ({ ...layer, power, passes })),
      },
    },
  }));
}

function operationSettings(project: Project): string[] {
  return project.scene.layers.map((layer) => `${layer.power}/${layer.passes}`);
}

function reimport(svgText: string, source = 'logo.svg') {
  const parsed = parseSvg({ svgText, id: 'again', source });
  if (parsed.fragment === undefined) throw new Error('Missing SVG fragment');
  const objects = parsed.fragment.entries.filter((entry) => entry.kind === 'imported-svg');
  const target = useStore.getState().project.scene.objects[0];
  if (target === undefined) throw new Error('Nothing to re-import over');
  const outcome = useStore
    .getState()
    .reimportSvgFragment(target.id, { source, bounds: parsed.fragment.bounds, objects });
  return { parsed, outcome };
}

/** What 1.0.29 saved: the import as parsed, white on its own operation, no marks. */
function importAsOlderBuild(svgText: string): Project {
  importSvg(svgText);
  useStore.getState().undo();
  const project = useStore.getState().project;
  const objects = project.scene.objects.map((object: SceneObject) =>
    'paths' in object
      ? {
          ...object,
          paths: object.paths.map(({ whiteInk: _mark, ...path }) => path),
        }
      : object,
  ) as SceneObject[];
  const older = { ...project, scene: { ...project.scene, objects } };
  useStore.setState({ project: older, undoStack: [], redoStack: [] });
  return older;
}

beforeEach(resetStore);
afterEach(resetStore);

describe('V7-P2-1: only flat, opaque white is paper', () => {
  it.each([
    ['fill-opacity="0.3"', badge('fill="#fff" fill-opacity="0.3"')],
    [
      'a group opacity',
      badge('fill="#fff"').replace(
        `<path d="${DIAMOND}" fill="#fff"/>`,
        `<g opacity="0.2"><path d="${DIAMOND}" fill="#fff"/></g>`,
      ),
    ],
    ['rgba(255,255,255,0.25)', badge('fill="rgba(255,255,255,0.25)"')],
    [
      'a CSS class with fill-opacity',
      badge('class="w"', '<style>.w{fill:#fff;fill-opacity:.15}</style>'),
    ],
    ['a white-first gradient', badge('fill="url(#g)"', GRADIENT('#fff', '#0040ff'))],
    [
      'a mask over half of it',
      badge(
        'fill="#fff" mask="url(#m)"',
        '<defs><mask id="m"><rect width="20" height="40" fill="#fff"/></mask></defs>',
      ),
    ],
  ])('burns a white written with %s as ink, as before ADR-686', (_case, svgText) => {
    const { outcome } = importSvg(svgText);
    expect(outcome).toEqual({
      kind: 'added',
      whiteKnockout: { whiteShapes: 0, removedObjects: 0, knockedShapes: 0, inkWhites: 1 },
    });
    // No knock-out step: the import is one Undo step, its white still burns.
    expect(useStore.getState().undoStack).toHaveLength(1);
    const project = useStore.getState().project;
    expect(burnInside(project, whiteOutlines(project))).toBeGreaterThan(50);
  });

  it('keeps a white-first gradient emblem whole, burning as the blue-first one does', () => {
    importSvg(emblem('#ffffff', '#0040ff'));
    const whiteFirst = burnLength(useStore.getState().project);
    resetStore();
    importSvg(emblem('#0040ff', '#ffffff'));
    const blueFirst = burnLength(useStore.getState().project);
    // The audit's emblem lost 5,373 → 2,240 mm; it now burns in full.
    expect(blueFirst).toBeGreaterThan(5000);
    expect(whiteFirst).toBeCloseTo(blueFirst, 6);
  });

  it('cuts solid white out of a gradient emblem, which is ink', () => {
    const { parsed, outcome } = importSvg(
      svg(
        `${GRADIENT('#fff', '#0040ff')}<circle cx="20" cy="20" r="15" fill="url(#g)"/>` +
          `<path d="${DIAMOND}" fill="#fff"/>`,
      ),
      'emblem.svg',
    );
    expect(outcome).toMatchObject({
      whiteKnockout: { whiteShapes: 1, knockedShapes: 1, inkWhites: 1 },
    });
    const project = useStore.getState().project;
    // The diamond is gone; the gradient circle (white too, but ink) stays.
    expect(objectPaths(project).map((path) => path.whiteInk)).toEqual(['gradient']);
    const toast = describeSvgImport('emblem.svg', parsed, outcome).at(-1);
    expect(toast).toEqual({
      message:
        'emblem.svg: 1 solid white shape will not burn: the file shows bare material there, ' +
        'so it was cut out of the shapes under it. To burn the white too, Undo: it returns on ' +
        'its own operation. 1 white shape is see-through, shaded or masked in the file, so it ' +
        "burns like any colour. To leave it unburned, turn its operation's Output off.",
      variant: 'warning',
    });
  });

  it('names see-through white as ink in an info notice, and still counts its colour', () => {
    const { parsed, outcome } = importSvg(badge('fill="#fff" fill-opacity="0.3"'), 'grey.svg');
    const toasts = describeSvgImport('grey.svg', parsed, outcome);
    expect(toasts[0]?.message).toBe('Imported grey.svg — 1 object, 2 colors');
    expect(toasts.at(-1)).toEqual({
      message:
        'grey.svg: 1 white shape is see-through, shaded or masked in the file, so it burns ' +
        "like any colour. To leave it unburned, turn its operation's Output off.",
      variant: 'info',
    });
  });

  it('keeps a design drawn only in white, see-through highlight included, for slate', () => {
    const { outcome } = importSvg(
      svg(
        '<circle cx="20" cy="20" r="15" fill="#fff"/>' +
          '<circle cx="20" cy="20" r="6" fill="#fff" fill-opacity="0.4"/>',
      ),
    );
    // Decision 2: no darker fill, so nothing is paper and nothing is named.
    expect(outcome).toEqual({ kind: 'added' });
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('says nothing was cut when a solid white background had nothing under it', () => {
    const { parsed, outcome } = importSvg(
      svg('<rect width="40" height="40" fill="#fff"/><circle cx="20" cy="20" r="10" fill="#000"/>'),
      'bg.svg',
    );
    expect(describeSvgImport('bg.svg', parsed, outcome).at(-1)?.message).toBe(
      'bg.svg: 1 solid white shape will not burn: the file shows bare material there. ' +
        'To burn the white too, Undo: it returns on its own operation.',
    );
  });
});

describe('V7-P2-2: an unchanged Re-import keeps a knocked-out logo’s settings', () => {
  const WHITE_LOGO = badge('fill="#fff"');
  const GREEN_LOGO = badge('fill="#00aa00"');

  it.each([
    ['white', WHITE_LOGO, 1],
    ['green (the audit’s control)', GREEN_LOGO, 2],
  ])('keeps 77 %% / 3 passes on the %s logo', (_name, svgText, operations) => {
    importSvg(svgText);
    tuneEveryOperation(77, 3);
    const before = useStore.getState().project;
    expect(operationSettings(before)).toEqual(Array(operations).fill('77/3'));

    const { parsed, outcome } = reimport(svgText);
    expect(outcome).toMatchObject({ kind: 'replaced', kept: 1, added: 0, removed: 0 });
    const after = useStore.getState().project;
    expect(operationSettings(after)).toEqual(Array(operations).fill('77/3'));
    expect(after.scene.layers.map((layer) => layer.id)).toEqual(
      before.scene.layers.map((layer) => layer.id),
    );
    expect(after.scene.objects.map((object) => object.id)).toEqual(
      before.scene.objects.map((object) => object.id),
    );
    expect(burnLength(after)).toBeCloseTo(burnLength(before), 6);
    const toast = describeSvgImport('logo.svg', parsed, outcome)[0];
    expect(toast).toEqual({
      message: 'Re-imported logo.svg — layer settings preserved (1 kept)',
      variant: 'success',
    });
  });

  it('puts the white back on its own operation with one Undo, the badge still tuned', () => {
    importSvg(WHITE_LOGO);
    tuneEveryOperation(77, 3);
    reimport(WHITE_LOGO);
    useStore.getState().undo();
    const asParsed = useStore.getState().project;
    expect(whiteOutlines(asParsed).length).toBeGreaterThan(0);
    const [badgeOperation, whiteOperation] = asParsed.scene.layers;
    expect(asParsed.scene.layers).toHaveLength(2);
    expect(`${badgeOperation?.power}/${badgeOperation?.passes}`).toBe('77/3');
    // The white's operation is new, so it starts from the defaults.
    expect(whiteOperation?.id).not.toBe(badgeOperation?.id);
    expect(burnInside(asParsed, whiteOutlines(asParsed))).toBeGreaterThan(50);
  });

  it('keeps the settings after the project is saved and opened again', () => {
    importSvg(WHITE_LOGO);
    tuneEveryOperation(77, 3);
    const saved = prepareProjectForPersistence(useStore.getState().project);
    if (saved.kind !== 'ok') throw new Error('save refused');
    const opened = deserializeProject(saved.json);
    if (opened.kind !== 'ok') throw new Error('open refused');
    resetStore();
    useStore.getState().setProject(opened.project);
    const { outcome } = reimport(WHITE_LOGO);
    expect(outcome).toMatchObject({ kept: 1, added: 0, removed: 0 });
    expect(operationSettings(useStore.getState().project)).toEqual(['77/3']);
  });

  it('keeps the operator’s choice to burn the white through an unchanged Re-import', () => {
    importSvg(WHITE_LOGO);
    useStore.getState().undo();
    expect(objectPaths(useStore.getState().project).map((path) => path.whiteInk)).toEqual([
      undefined,
      'kept',
    ]);
    const { outcome } = reimport(WHITE_LOGO);
    expect(outcome).toEqual({
      kind: 'replaced',
      source: 'logo.svg',
      kept: 1,
      added: 0,
      removed: 0,
    });
    const project = useStore.getState().project;
    expect(burnInside(project, whiteOutlines(project))).toBeGreaterThan(50);
  });
});

describe('V2-P2-1: a logo saved before the knock-out', () => {
  const LOGO = badge('fill="#fff"');

  it('is named at open and in Job Review, and its burn is unchanged', () => {
    const older = importAsOlderBuild(LOGO);
    const before = burnLength(older);
    const saved = prepareProjectForPersistence(older);
    if (saved.kind !== 'ok') throw new Error('save refused');
    resetStore();
    const toasts: string[] = [];
    const opened = completeNativeProjectOpen(
      {
        setProject: (project) => useStore.getState().setProject(project),
        markLoaded: () => undefined,
        pushToast: (message) => toasts.push(message),
      },
      'logo.lf2',
      deserializeProject(saved.json),
    );
    expect(opened).toBe(true);
    const project = useStore.getState().project;
    expect(burnLength(project)).toBeCloseTo(before, 6);
    expect(toasts).toContain(
      'This project has 1 white shape from an SVG import that burns over the darker fill under ' +
        'it, as KerfDesk 1.0.29 and earlier imported white. Its burn is unchanged. To leave the ' +
        'white unburned, as a new import does, choose Tools > Leave Imported White Unburned, or ' +
        'Leave white unburned in Job Review. One Undo burns the white again.',
    );
    const [row] = burningWhiteReviewWarnings(project);
    expect(row).toMatch(/^White in an imported logo burns: 1 white shape/);
    expect(reviewNoteRank(row ?? '')).toBe('beginner');
  });

  it('burns as a fresh import after Leave white unburned, and one Undo burns the white again', () => {
    importSvg(LOGO);
    const fresh = burnLength(useStore.getState().project);
    resetStore();
    const older = importAsOlderBuild(LOGO);
    expect(countBurningImportedWhites(older.scene)).toBe(1);

    expect(useStore.getState().leaveSavedWhiteUnburned()).toBe(1);
    const knocked = useStore.getState().project;
    expect(burnLength(knocked)).toBeCloseTo(fresh, 6);
    expect(whiteOutlines(knocked)).toEqual([]);
    expect(burningWhiteOpenNotice(knocked)).toBeNull();

    useStore.getState().undo();
    const undone = useStore.getState().project;
    expect(burnLength(undone)).toBeCloseTo(burnLength(older), 6);
    // The white burns again by the operator's choice, so nothing asks any more.
    expect(countBurningImportedWhites(undone.scene)).toBe(0);
    expect(burningWhiteReviewWarnings(undone)).toEqual([]);
    useStore.getState().redo();
    expect(useStore.getState().project).toEqual(knocked);
  });

  it('leaves alone a white whose operation already has Output off', () => {
    const older = importAsOlderBuild(LOGO);
    const whiteOperation = older.scene.layers[1];
    useStore.setState({
      project: {
        ...older,
        scene: {
          ...older.scene,
          layers: older.scene.layers.map((layer) =>
            layer.id === whiteOperation?.id ? { ...layer, output: false } : layer,
          ),
        },
      },
    });
    const project = useStore.getState().project;
    expect(countBurningImportedWhites(project.scene)).toBe(0);
    expect(burningWhiteOpenNotice(project)).toBeNull();
    expect(useStore.getState().leaveSavedWhiteUnburned()).toBe(0);
    expect(useStore.getState().project).toBe(project);
  });

  it('says nothing for a fresh import, a design all in white or see-through white', () => {
    importSvg(LOGO);
    expect(burningWhiteOpenNotice(useStore.getState().project)).toBeNull();
    resetStore();
    importAsOlderBuild(svg('<circle cx="20" cy="20" r="15" fill="#fff"/>'));
    expect(burningWhiteOpenNotice(useStore.getState().project)).toBeNull();
    resetStore();
    importSvg(badge('fill="#fff" fill-opacity="0.3"'));
    expect(burningWhiteOpenNotice(useStore.getState().project)).toBeNull();
  });
});
