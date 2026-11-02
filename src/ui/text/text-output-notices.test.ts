import { describe, expect, it, vi } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import {
  createLayer,
  createProject,
  DEFAULT_PROJECT_VARIABLE_DATA,
  IDENTITY_TRANSFORM,
  type Project,
  type TextObject,
} from '../../core/scene';
import {
  materializeVariableText,
  prepareOutputSnapshot,
  textAdvisoryWarnings,
  withTextGlyphCheck,
} from '../../io/gcode/prepare-output-snapshot';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { emitPreparedRdFile } from '../../io/rd/emit-rd';
import type { SaveTarget } from '../../platform/types';
import { handleExportArtworkSvg } from '../app/export-artwork-svg';
import { handleSaveGcode } from '../app/file-actions';
import { emitSavePreparedOutput } from '../laser/save-output-emission';
import { reviewProjection } from '../remote-control/status-projections';
import type { RemoteControlOptions, SafeRemoteJobReview } from '../remote-control/types';
import { buildTextObject } from './build-text-object';
import { outputTextRenderer } from './output-text-renderer';
import type { DialogValues } from './use-text-dialog-fields';

// One buffer, as the real loader caches it: the parsed-font cache keys on it, and 200 copies would
// otherwise parse the font 200 times.
vi.mock('./font-loader', () => {
  let buffer: Promise<ArrayBuffer> | undefined;
  return {
    loadFont: () =>
      (buffer ??= import('node:fs/promises').then(
        async ({ readFile }) =>
          Uint8Array.from(await readFile('src/ui/text/fonts/Pacifico-Regular.ttf')).buffer,
      )),
  };
});

// Rolling audit v9 R4-P2-3 and R4-P2-4 (ADR-591 Amendment 3).
const CAFE = 'Text “Café 李”: Pacifico has no 李; each engraves as a box, or not at all.';
const NOW = new Date('2026-11-02T00:00:00Z');

describe('a text’s notices share one toast per output (R4-P2-3)', () => {
  it('counts 200 copies of one text in its one warning', async () => {
    const cafe = await text({ content: 'Café 李' });
    const copies = Array.from({ length: 200 }, (_, index) => ({ ...cafe, id: `copy-${index}` }));
    // The warnings alone: compiling 200 overlapping outlines takes minutes and says nothing more.
    const resolved = await materializeVariableText(
      sceneOf(copies),
      { now: NOW },
      outputTextRenderer,
    );
    if (!resolved.ok) throw new Error('the copies did not resolve');
    expect(textAdvisoryWarnings(resolved.advisories)).toEqual([
      'Text “Café 李” (200 copies): Pacifico has no 李; each engraves as a box, or not at all.',
    ]);
  });

  it('counts copies through prepared output too', async () => {
    const cafe = await text({ content: 'Café 李' });
    expect(await warnings([cafe, { ...cafe, id: 'copy' }])).toEqual([
      'Text “Café 李” (2 copies): Pacifico has no 李; each engraves as a box, or not at all.',
    ]);
  });

  it('merges three different texts, naming each with its characters', async () => {
    const list = await Promise.all(
      ['Café 李', 'Zoë 東', 'Anna 京'].map(async (content, index) => ({
        ...(await text({ content })),
        id: `text-${index}`,
      })),
    );
    const merged = await warnings(list);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toContain('Missing characters in 3 texts:');
    expect(merged[0]).toContain('“Café 李” (Pacifico: 李)');
    expect(merged[0]).toContain('“Zoë 東” (Pacifico: 東)');
    expect(merged[0]).toContain('“Anna 京” (Pacifico: 京)');
  });

  it('caps the texts it names and says how many more', async () => {
    const list = await Promise.all(
      Array.from({ length: 9 }, async (_, index) => ({
        ...(await text({ content: `Row ${index} 李` })),
        id: `text-${index}`,
      })),
    );
    const merged = await warnings(list);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toContain('Missing characters in 9 texts:');
    expect(merged[0]).toContain('“Row 4 李”');
    expect(merged[0]).not.toContain('“Row 5 李”');
    expect(merged[0]).toContain('and 4 more');
  });

  it('caps the characters one text names', async () => {
    const content = 'Café 一二三四五六七八九十百千万';
    const merged = await warnings([await text({ content })]);
    expect(merged[0]).toContain('and 1 more;');
    expect(merged[0]).not.toContain('Pacifico has no 一 二 三 四 五 六 七 八 九 十 百 千 万');
  });

  it('keeps a single text’s sentence as it was', async () => {
    expect(await warnings([await text({ content: 'Café 李' })])).toEqual([CAFE]);
  });

  it('puts the merged notice before a route’s other findings in .rd', async () => {
    const project = sceneOf([
      await text({ content: 'Café 李' }),
      await text({ content: 'Zoë 東' }),
    ]);
    const prepared = await withTextGlyphCheck(prepareOutput(project), project, outputTextRenderer);
    if (!prepared.ok) throw new Error('output was refused');
    const rd = emitPreparedRdFile(prepared, {});
    if (!rd.ok) throw new Error('.rd was refused');
    const glyphAt = rd.advisories.findIndex((issue) => issue.code === 'text-missing-glyphs');
    expect(glyphAt).toBe(0);
    expect(rd.advisories.filter((issue) => issue.code === 'text-missing-glyphs')).toHaveLength(1);
  });

  it('merges in Save G-code’s warnings', async () => {
    const list = [await text({ content: 'Café 李' }), await text({ content: 'Zoë 東' })];
    const saved = emitSavePreparedOutput(await snapshotOf(sceneOf(list)), {});
    expect(saved.kind === 'emitted' && saved.machineWarnings?.length).toBe(1);
  });

  it('shows the job off the bed among the toasts Save leaves on screen', async () => {
    // Only the newest three toasts render (Toasts.tsx). Five texts raised five glyph toasts after
    // the off-bed advisory, and the controller note after those.
    const list = await Promise.all(
      ['Café 李', 'Zoë 東', 'Anna 京', 'Ågot 北', 'Bo 南'].map(async (content, index) => ({
        ...(await text({ content })),
        id: `text-${index}`,
        transform: { ...IDENTITY_TRANSFORM, x: 5000, y: 5000 },
      })),
    );
    const toasts: string[] = [];
    const target: SaveTarget = { displayName: 'tag.gcode', write: async () => undefined };
    await handleSaveGcode({
      platform: mockPlatform({ save: async () => target }),
      project: sceneOf(list),
      savedName: null,
      pushToast: (message) => toasts.push(message),
    });
    const newestThree = toasts.slice(-3);
    expect(newestThree.some((message) => /bed/i.test(message))).toBe(true);
  });

  it('merges in an SVG export’s one toast', async () => {
    const pushToast = vi.fn();
    await handleExportArtworkSvg({
      platform: mockPlatform({
        save: async (): Promise<SaveTarget> => ({
          displayName: 'artwork.svg',
          write: async () => undefined,
        }),
      }),
      project: sceneOf([await text({ content: 'Café 李' }), await text({ content: 'Zoë 東' })]),
      selectedIds: [],
      savedName: null,
      pushToast,
    });
    const [message, variant] = pushToast.mock.calls.at(-1) ?? [];
    expect(variant).toBe('warning');
    expect(message).toContain('Missing characters in 2 texts:');
  });

  it('reaches a phone’s review as one warning, like the PC’s', async () => {
    const [merged] = await warnings([
      await text({ content: 'Café 李' }),
      await text({ content: 'Zoë 東' }),
    ]);
    const review: SafeRemoteJobReview = {
      revision: 'current',
      mode: 'laser',
      status: 'ready',
      summary: { artworkCount: 2, operationCount: 1, estimatedSeconds: 42 },
      warnings: [{ code: 'text-missing-glyphs', severity: 'warning', message: merged ?? '' }],
      frame: { required: true, complete: true },
    };
    const options: RemoteControlOptions = {
      getReview: () => review,
      canWrite: () => false,
      getAppStatus: () => ({
        app: { name: 'KerfDesk', version: 'test', platform: 'desktop' },
        edition: { mode: 'free' },
        updates: { available: false },
      }),
    };
    const projected = await reviewProjection(options, 'current', 'laser');
    expect(projected['warnings']).toHaveLength(1);
  });
});

describe('Right-to-left on a single-line font (R4-P2-4)', () => {
  const RELIEF = { fontKey: 'relief-single-line', content: 'Strasse' };
  const SUPPORTED =
    'Text “Strasse”: Right-to-left isn’t supported on Relief SingleLine, so it burns left to right.';

  it('burns the same ink as the same text left to right', async () => {
    const plain = await text(RELIEF);
    const rtl = await text({ ...RELIEF, textStyle: { forceRtl: true } });
    expect(rtl.bounds).toEqual(plain.bounds);
    expect(rtl.paths).toEqual(plain.paths);
  });

  it('draws no ? for any line of several', async () => {
    const plain = await text({ ...RELIEF, content: 'AB\nCD' });
    const rtl = await text({ ...RELIEF, content: 'AB\nCD', textStyle: { forceRtl: true } });
    expect(rtl.bounds).toEqual(plain.bounds);
  });

  it('draws no ? for a bidi mark typed or pasted into the text', async () => {
    const plain = await text(RELIEF);
    const marked = await text({ ...RELIEF, content: '‏Strasse‬' });
    expect(marked.bounds).toEqual(plain.bounds);
    expect(await warnings([marked])).toEqual([]);
  });

  it('says plainly it is not supported, and names no invisible characters', async () => {
    const rtl = await text({ ...RELIEF, textStyle: { forceRtl: true } });
    expect(await warnings([rtl])).toEqual([SUPPORTED]);
  });

  it('says so for a variable record too', async () => {
    const rtl = await text({
      ...RELIEF,
      content: '{{csv:name}}',
      variableTemplate: { tokens: [] },
      textStyle: { forceRtl: true },
    });
    const project: Project = {
      ...sceneOf([rtl]),
      variables: {
        ...DEFAULT_PROJECT_VARIABLE_DATA,
        csv: { sourceName: 'names.csv', headers: ['name'], records: [['Anna']] },
      },
    };
    const prepared = await snapshotOf(project);
    if (!prepared.ok) throw new Error('output was refused');
    expect((prepared.advisories ?? []).map((issue) => issue.message)).toEqual([
      'Text “Anna”: Right-to-left isn’t supported on Relief SingleLine, so it burns left to right.',
    ]);
  });

  it('leaves outline fonts alone', async () => {
    const rtl = await text({ content: 'Café', textStyle: { forceRtl: true } });
    expect(await warnings([rtl])).toEqual([]);
  });
});

async function text(patch: Partial<DialogValues>): Promise<TextObject> {
  const built = await buildTextObject(
    { mode: 'add' },
    {
      content: 'Café',
      fontKey: 'pacifico-regular',
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1.2,
      letterSpacing: 0,
      bendDeg: 0,
      color: '#000000',
      embeddedFonts: [],
      weldOverlaps: false,
      ...patch,
    },
  );
  return { ...built, transform: { ...IDENTITY_TRANSFORM, x: 50, y: 50 } };
}

function sceneOf(objects: ReadonlyArray<TextObject>): Project {
  return {
    ...createProject(),
    scene: {
      objects: [...objects],
      layers: [{ ...createLayer({ id: '#000000', color: '#000000' }), mode: 'line' }],
      groups: [],
    },
  };
}

function snapshotOf(project: Project): ReturnType<typeof prepareOutputSnapshot> {
  return prepareOutputSnapshot(project, {
    clock: () => NOW,
    renderVariableText: outputTextRenderer,
    recordIndex: 0,
  });
}

async function warnings(objects: ReadonlyArray<TextObject>): Promise<ReadonlyArray<string>> {
  const prepared = await snapshotOf(sceneOf(objects));
  if (!prepared.ok) throw new Error('output was refused');
  return (prepared.advisories ?? []).map((issue) => issue.message);
}
