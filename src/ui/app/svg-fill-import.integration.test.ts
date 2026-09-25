import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job/compile-job';
import { createLayer, createProject, type Project } from '../../core/scene';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { deserializeProject, serializeProject } from '../../io/project';
import { parseSvg, type ParseSvgResult } from '../../io/svg/parse-svg';
import { readSvgDocumentFromBlob } from '../../io/svg/parse-svg-blob';
import { parseSvgInWorker, parseSvgWorkerDocument } from '../../io/svg/parse-svg-worker';
import { applySvgFragmentImport } from '../state/svg-fragment-mutation';

const identity = { id: 'source', source: 'fill.svg' };
const compound = 'M1 1H19V19H1Z M5 5H15V15H5Z';
const oppositeWinding = 'M1 1H19V19H1Z M5 5V15H15V5Z';
const svg = (content: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20">${content}</svg>`;

type Parser = (svgText: string) => ParseSvgResult | Promise<ParseSvgResult>;
const parsers: readonly (readonly [string, Parser])[] = [
  ['browser fallback', (svgText) => parseSvg({ svgText, ...identity })],
  ['worker text', (svgText) => parseSvgInWorker({ svgText, ...identity })],
  [
    'worker stream',
    async (svgText) =>
      parseSvgWorkerDocument(
        await readSvgDocumentFromBlob(new NodeBlob([svgText], { type: 'image/svg+xml' }) as Blob),
        identity,
      ),
  ],
];

async function importArtwork(content: string, parse: Parser) {
  const parsed = await parse(svg(content));
  if (parsed.fragment === undefined) throw new Error('Missing SVG fragment');
  const objects = parsed.fragment.entries.filter((entry) => entry.kind === 'imported-svg');
  const { project } = applySvgFragmentImport(
    { project: createProject(), undoStack: [] },
    { ...parsed.fragment, objects },
    0,
  );
  return { project, parsed, objects };
}

function burnLength(project: Project): number {
  let length = 0;
  for (const group of compileJob(project.scene, project.device).groups) {
    if (!('segments' in group)) continue;
    for (const segment of group.segments) {
      for (let index = 1; index < segment.polyline.length; index += 1) {
        const a = segment.polyline[index - 1]!;
        const b = segment.polyline[index]!;
        length += Math.hypot(b.x - a.x, b.y - a.y);
      }
    }
  }
  return length;
}

function reload(project: Project): Project {
  const loaded = deserializeProject(serializeProject(project));
  if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
  return loaded.project;
}

function emittedMotion(project: Project): readonly string[] {
  return emitGcode(project)
    .gcode.split('\n')
    .filter((line) => /^G[0123]\b/.test(line) && /\b[XY]-?\d/.test(line));
}

describe.each(parsers)('SVG fill import to compiled output through %s', (_name, parse) => {
  it.each([
    ['path', '<path fill="black" d="M1 1L19 1L19 19"/>', 'M1 1L19 1L19 19Z'],
    ['polyline', '<polyline fill="black" points="1,1 19,1 19,19"/>', 'M1 1L19 1L19 19Z'],
    ['cubic', '<path fill="black" d="M1 1C19 1 19 19 1 19"/>', 'M1 1C19 1 19 19 1 19Z'],
  ])(
    'implicitly closes a filled %s in sampled and native geometry',
    async (_shape, open, closed) => {
      const actual = await importArtwork(open, parse);
      const explicit = await importArtwork(`<path fill="black" d="${closed}"/>`, parse);
      const expectedLength = burnLength(explicit.project);
      expect(expectedLength).toBeGreaterThan(100);
      expect(burnLength(actual.project)).toBeCloseTo(expectedLength, 8);
      expect(burnLength(reload(actual.project))).toBeCloseTo(expectedLength, 8);
      const path = actual.objects[0]!.paths[0]!;
      const curve = path.curves![0]!;
      expect(path.fillRule).toBe('nonzero');
      expect(path.polylines.every((line) => line.closed)).toBe(true);
      expect(path.curves!.every((entry) => entry.closed)).toBe(true);
      expect(curve.segments[0]).toEqual(explicit.objects[0]!.paths[0]!.curves![0]!.segments[0]);
      expect(curve.segments[0]?.kind).toBe(_shape === 'cubic' ? 'cubic' : 'line');
      // Existing vector-only callers keep the original geometry and defaults.
      const legacy = actual.parsed.object!.paths[0]!;
      expect(legacy.fillRule).toBeUndefined();
      expect(legacy.polylines[0]?.closed).toBe(false);
      expect(legacy.curves?.[0]?.closed).toBe(false);
    },
  );

  it('uses nonzero for an omitted rule without losing explicit evenodd holes', async () => {
    const implicit = await importArtwork(`<path fill="black" d="${compound}"/>`, parse);
    const nonzero = await importArtwork(
      `<path fill="black" fill-rule="nonzero" d="${compound}"/>`,
      parse,
    );
    const evenodd = await importArtwork(
      `<path fill="black" fill-rule="evenodd" d="${compound}"/>`,
      parse,
    );
    // At 0.1 mm hatch pitch: the 18 x 18 square is solid under nonzero,
    // while evenodd removes the 10 x 10 inner square (1000 mm of travel).
    expect(burnLength(implicit.project)).toBeCloseTo(3240, 8);
    expect(burnLength(nonzero.project)).toBeCloseTo(3240, 8);
    expect(burnLength(evenodd.project)).toBeCloseTo(2240, 8);
    expect(burnLength(reload(evenodd.project))).toBeCloseTo(2240, 8);
  });

  it.each([
    [
      'implicit closure',
      '<path fill="black" d="M1 1L19 1L19 19"/>',
      '<path fill="black" d="M1 1L19 1L19 19Z"/>',
    ],
    [
      'default nonzero',
      `<path fill="black" d="${compound}"/>`,
      `<path fill="black" fill-rule="nonzero" d="${compound}"/>`,
    ],
  ])('emits equivalent nonempty G-code motion for %s', async (_rule, implicit, explicit) => {
    const expected = emittedMotion((await importArtwork(explicit, parse)).project);
    expect(expected.filter((line) => /^G1\b/.test(line)).length).toBeGreaterThan(100);
    expect(emittedMotion((await importArtwork(implicit, parse)).project)).toEqual(expected);
  });

  it.each([
    ['opposite winding', `<path fill="black" d="${oppositeWinding}"/>`, 2240],
    ['inherited evenodd', `<g fill="black" fill-rule="evenodd"><path d="${compound}"/></g>`, 2240],
    [
      'local nonzero override',
      `<g fill="black" fill-rule="evenodd"><path style="fill-rule:nonzero" d="${compound}"/></g>`,
      3240,
    ],
    ['inherited default', `<g fill="black"><path d="${compound}"/></g>`, 3240],
  ])('preserves %s in compiled fill', async (_rule, content, expectedLength) => {
    expect(burnLength((await importArtwork(content, parse)).project)).toBeCloseTo(
      expectedLength,
      8,
    );
  });

  it.each([
    ['stroke only', 'fill="none" stroke="blue"', false],
    ['fill and stroke', 'fill="red" stroke="blue"', true],
    ['transparent fill', 'fill="red" fill-opacity="0%" stroke="blue"', false],
  ])('keeps an open %s as two emitted edges', async (_style, attributes, omittedFill) => {
    const { project, parsed, objects } = await importArtwork(
      `<path ${attributes} d="M1 1L19 1L19 19"/>`,
      parse,
    );
    expect(project.scene.layers.map((layer) => layer.mode)).toEqual(['line']);
    expect(objects[0]?.paths[0]?.polylines[0]?.closed).toBe(false);
    expect(objects[0]?.paths[0]?.curves?.[0]?.closed).toBe(false);
    expect(burnLength(project)).toBeCloseTo(36, 8);
    expect(emittedMotion(project).filter((line) => /^G1\b/.test(line))).toHaveLength(2);
    expect(parsed.notes.some((note) => note.includes('fills were omitted'))).toBe(omittedFill);
  });

  it.each(['0', '0%'])('fills and closes artwork with transparent stroke %s', async (opacity) => {
    const { project, parsed } = await importArtwork(
      `<g fill="red" stroke="blue" stroke-opacity="${opacity}"><path d="M1 1L19 1L19 19"/></g>`,
      parse,
    );
    expect(project.scene.layers.map((layer) => layer.mode)).toEqual(['fill']);
    expect(burnLength(project)).toBeCloseTo(1611, 8);
    expect(parsed.notes).toEqual([]);
  });
});

it.each([6, 8, 9])('does not reinterpret legacy paths when loading schema %i', (schemaVersion) => {
  const base = createProject();
  for (const [d, expectedLength] of [
    ['M1 1L19 1L19 19', 0],
    [compound, 2240],
  ] as const) {
    const object = parseSvg({ ...identity, svgText: svg(`<path fill="black" d="${d}"/>`) }).object;
    if (object === null) throw new Error('Missing legacy aggregate');
    const project: Project = {
      ...base,
      scene: {
        ...base.scene,
        objects: [{ ...object, operationIds: ['fill'] }],
        layers: [createLayer({ id: 'fill', color: '#000000', mode: 'fill' })],
      },
    };
    const loaded = deserializeProject(JSON.stringify({ ...project, schemaVersion }));
    if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
    expect(loaded.project.scene.objects[0]).toMatchObject({ paths: object.paths });
    expect(burnLength(loaded.project)).toBeCloseTo(expectedLength, 8);
    expect(burnLength(reload(loaded.project))).toBeCloseTo(expectedLength, 8);
  }
});
