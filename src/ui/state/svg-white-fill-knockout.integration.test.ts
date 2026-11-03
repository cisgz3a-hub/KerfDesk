// UX audit U3-P2-2 (ledgered P1): a logo's white shapes burned, and burned a
// second time over the black fill under them. White fills are now paper
// (ADR-686): cut out of the fills painted before them and left out, with one
// Undo step that puts them back on their own operation.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toMachineCoords } from '../../core/devices';
import { compileJob } from '../../core/job/compile-job';
import { applyTransform, type Project, type SceneObject, type Vec2 } from '../../core/scene';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { applyImportWhiteKnockout } from './import-white-knockout';
import { parseSvg } from '../../io/svg/parse-svg';
import { describeSvgImport } from '../app/svg-import-action';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const DIAMOND = 'M14 20 L20 12 L26 20 L20 28 Z';
const BADGE_EVENODD = `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">
  <path fill="#000" fill-rule="evenodd" d="M5 20 A15 15 0 1 0 35 20 A15 15 0 1 0 5 20 Z ${DIAMOND}"/>
</svg>`;
const badge = (
  white: string,
) => `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">
  <circle cx="20" cy="20" r="15" fill="#000"/>
  <path d="${DIAMOND}" ${white}/>
</svg>`;
const BADGE_STYLE = `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">
  <defs><style>.k{fill:#231f20}.w{fill:#ffffff}</style></defs>
  <circle class="k" cx="20" cy="20" r="15"/>
  <path style="fill:#FFFFFF" d="${DIAMOND}"/>
  <rect class="w" x="18" y="30" width="4" height="3"/>
</svg>`;
const KNOCKOUT_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="20mm" viewBox="0 0 60 20">
  <rect x="0" y="0" width="60" height="20" fill="#000000"/>
  <path d="M5 4 H13 V7 H8 V9 H12 V12 H8 V16 H5 Z" fill="#FFFFFF"/>
  <path d="M16 4 H19 V13 H24 V16 H16 Z" fill="#FFFFFF"/>
</svg>`;
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="40mm" viewBox="0 0 80 40">
  <rect x="1" y="1" width="78" height="38" rx="4" fill="none" stroke="#ff0000" stroke-width="0.3"/>
  <circle cx="20" cy="20" r="12" fill="#000000"/>
  <path d="${DIAMOND}" fill="#ffffff"/>
  <path d="M38 14 H72 M38 20 H66 M38 26 H70" stroke="#0000ff" stroke-width="0.5" fill="none"/>
</svg>`;

function importSvg(svgText: string, source = 'logo.svg') {
  const parsed = parseSvg({ svgText, id: 'logo', source });
  if (parsed.fragment === undefined) throw new Error('Missing SVG fragment');
  const objects = parsed.fragment.entries.filter((entry) => entry.kind === 'imported-svg');
  const outcome = useStore
    .getState()
    .importSvgFragment({ source, bounds: parsed.fragment.bounds, objects });
  return { parsed, outcome };
}

/** The white shapes' outlines in machine coordinates, like the compiled burn. */
function whiteOutlines(project: Project): Vec2[][] {
  return project.scene.objects.flatMap((object: SceneObject) =>
    'paths' in object
      ? object.paths
          .filter((path) => path.color === '#ffffff')
          .flatMap((path) =>
            path.polylines.map((line) =>
              line.points.map((point) =>
                toMachineCoords(applyTransform(point, object.transform), project.device),
              ),
            ),
          )
      : [],
  );
}

function burnSegments(project: Project): Vec2[][] {
  return compileJob(project.scene, project.device).groups.flatMap((group) =>
    'segments' in group ? group.segments.map((segment) => [...segment.polyline]) : [],
  );
}

function burnLength(project: Project): number {
  let length = 0;
  for (const line of burnSegments(project))
    for (let index = 1; index < line.length; index += 1)
      length += Math.hypot(
        line[index]!.x - line[index - 1]!.x,
        line[index]!.y - line[index - 1]!.y,
      );
  return length;
}

function inside(point: Vec2, polygon: readonly Vec2[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > point.y !== b.y > point.y) {
      const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < x) hit = !hit;
    }
  }
  return hit;
}

function edgeDistance(point: Vec2, polygon: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[j]!;
    const b = polygon[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
    );
    best = Math.min(best, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)));
  }
  return best;
}

/** Burned length strictly inside a white shape (0.05 mm clear of its edge). */
function burnInside(project: Project, outlines: readonly Vec2[][]): number {
  const step = 0.02;
  let length = 0;
  for (const line of burnSegments(project))
    for (let index = 1; index < line.length; index += 1) {
      const a = line[index - 1]!;
      const b = line[index]!;
      const span = Math.hypot(b.x - a.x, b.y - a.y);
      const samples = Math.max(1, Math.ceil(span / step));
      for (let sample = 0; sample < samples; sample += 1) {
        const t = (sample + 0.5) / samples;
        const point = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
        if (
          outlines.some((outline) => inside(point, outline) && edgeDistance(point, outline) > 0.05)
        )
          length += span / samples;
      }
    }
  return length;
}

beforeEach(resetStore);
afterEach(resetStore);

describe.each([
  ['fill="#fff"', badge('fill="#fff"'), 1],
  ['fill="white"', badge('fill="white"'), 1],
  ['a style attribute and a CSS class', BADGE_STYLE, 2],
  ['white letters on a black plate', KNOCKOUT_TEXT, 2],
  ["the auditor's logo", LOGO, 1],
])('a white fill written as %s', (_spelling, svgText, whiteShapes) => {
  it('burns nothing inside the white shapes, once Undo has shown they would burn', () => {
    const { outcome } = importSvg(svgText);
    expect(outcome).toMatchObject({ kind: 'added', whiteKnockout: { whiteShapes } });
    const knocked = useStore.getState().project;
    expect(whiteOutlines(knocked)).toEqual([]);
    expect(knocked.scene.layers.every((layer) => layer.mode !== 'fill' || layer.output)).toBe(true);

    useStore.getState().undo();
    const asParsed = useStore.getState().project;
    const outlines = whiteOutlines(asParsed);
    expect(outlines.length).toBeGreaterThan(0);
    // Without the knock-out the white area burns, twice (the audit's G-code).
    expect(burnInside(asParsed, outlines)).toBeGreaterThan(50);
    expect(burnInside(knocked, outlines)).toBe(0);
    // The black around the white still burns.
    expect(burnLength(knocked)).toBeGreaterThan(burnLength(asParsed) / 3);

    useStore.getState().redo();
    expect(useStore.getState().project).toEqual(knocked);
  });
});

it('burns a white diamond the same as the even-odd hole the control fixture cuts', () => {
  importSvg(badge('fill="#fff"'));
  const knocked = burnLength(useStore.getState().project);
  resetStore();
  const { outcome } = importSvg(BADGE_EVENODD);
  expect(outcome).toEqual({ kind: 'added' });
  const control = useStore.getState().project;
  expect(
    control.scene.objects[0]?.kind === 'imported-svg' && control.scene.objects[0].paths,
  ).toHaveLength(1);
  expect(knocked).toBeGreaterThan(5000);
  // The knock-out is flattened at the machine tolerance, the control is not.
  expect(Math.abs(knocked - burnLength(control)) / burnLength(control)).toBeLessThan(0.005);
});

it('names the white shapes in the import notice and drops white from the colour count', () => {
  const { parsed, outcome } = importSvg(KNOCKOUT_TEXT, 'plate.svg');
  const toasts = describeSvgImport('plate.svg', parsed, outcome).map((toast) => toast.message);
  expect(toasts[0]).toBe('Imported plate.svg — 1 object, 1 color');
  expect(toasts.at(-1)).toBe(
    'plate.svg: 2 white shapes will not burn, as in the file: they were cut out of the shapes ' +
      'under them. To burn the white too, Undo: it returns on its own operation.',
  );
});

it('leaves a white background unburned and the dark art over it whole', () => {
  const art = '<circle cx="20" cy="20" r="10" fill="#000"/>';
  const withBackground = `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">
    <rect width="40" height="40" fill="#fff"/>${art}</svg>`;
  const { outcome } = importSvg(withBackground);
  expect(outcome).toMatchObject({ whiteKnockout: { whiteShapes: 1 } });
  const knocked = useStore.getState().project;
  resetStore();
  importSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">${art}</svg>`,
  );
  const plain = useStore.getState().project;
  const paths = (project: Project) =>
    project.scene.objects.flatMap((object) => ('paths' in object ? object.paths : []));
  expect(paths(knocked).map((path) => path.curves)).toEqual(
    paths(plain).map((path) => path.curves),
  );
  expect(burnLength(knocked)).toBeCloseTo(burnLength(plain), 6);
});

it('keeps a dark shape painted over the white whole, as SVG paints it', () => {
  const dotted = `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="15" fill="#000"/>
    <path d="${DIAMOND}" fill="#fff"/>
    <circle cx="20" cy="20" r="2" fill="#000"/>
  </svg>`;
  importSvg(dotted);
  const project = useStore.getState().project;
  const paths = project.scene.objects.flatMap((object) => ('paths' in object ? object.paths : []));
  // The badge lost its diamond; the dot, painted later, keeps its exact circle.
  expect(paths).toHaveLength(2);
  expect(paths[0]?.curves).toBeUndefined();
  expect(paths[1]?.curves?.[0]?.segments.some((segment) => segment.kind !== 'line')).toBe(true);
  const dot = project.scene.objects[0]!;
  const centre = toMachineCoords(applyTransform({ x: 20, y: 20 }, dot.transform), project.device);
  const disc = Array.from({ length: 64 }, (_, index) => ({
    x: centre.x + 1.9 * Math.cos((index / 64) * 2 * Math.PI),
    y: centre.y + 1.9 * Math.sin((index / 64) * 2 * Math.PI),
  }));
  expect(burnInside(project, [disc])).toBeGreaterThan(20);
});

it('keeps a design drawn only in white, for dark material, as it was', () => {
  const allWhite = `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="15" fill="#fff"/></svg>`;
  const { outcome } = importSvg(allWhite);
  expect(outcome).toEqual({ kind: 'added' });
  expect(useStore.getState().undoStack).toHaveLength(1);
  expect(burnLength(useStore.getState().project)).toBeGreaterThan(5000);
});

it('leaves the G-code of an import without white fills byte-identical', () => {
  const dark = LOGO.replace('fill="#ffffff"', 'fill="#00aa00"');
  const { outcome } = importSvg(dark);
  expect(outcome).toEqual({ kind: 'added' });
  // No knock-out step ran, so the import is the one it was before ADR-686.
  expect(useStore.getState().undoStack).toHaveLength(1);
  const placed = useStore.getState();
  const unchanged = applyImportWhiteKnockout(placed);
  expect(unchanged.state).toBe(placed);
  expect(unchanged.whiteKnockout).toBeUndefined();
  expect(emitGcode(placed.project).gcode).toContain('G1');
});
