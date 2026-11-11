import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { burnedTabSpans } from '../../__fixtures__/burned-tab-spans';
import { burnMetrics, type BurnMetrics } from '../../__fixtures__/returning-user/burn-metrics';
import { cncCutExtent, type CncCutExtent } from '../../__fixtures__/returning-user/cnc-cut-extent';
import type { JobOriginPlacement } from '../../core/job';
import type { Project, TextObject, Vec2 } from '../../core/scene';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutputSnapshot } from '../../io/gcode/prepare-output-snapshot';
import { deserializeProject } from '../../io/project/deserialize-project';
import { completeNativeProjectOpen } from '../app/project-open-completion';
import { oldProjectBurnReviewWarnings } from '../state/old-project-burn-review';
import { pushProjectLoadNotices } from '../state/project-load-notices';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { buildTextObject } from './build-text-object';
import { renderVariableText } from './render-variable-text';
import type { DialogValues } from './use-text-dialog-fields';

vi.mock('./font-loader', () => ({
  loadFont: async () => {
    const { readFile } = await import('node:fs/promises');
    return Uint8Array.from(await readFile('src/ui/text/fonts/Roboto-Regular.ttf')).buffer;
  },
}));

// Projects saved by the published 1.0.29 (`df2279e26`, schema 21), each built
// on that release and measured there; see the folder's README. A returning
// user's file opens without a notice and burns what 1.0.29 burned. A
// deliberate burn change updates an expectation here with its ADR number; it
// never rewrites a sidecar.
const FOLDER = 'src/__fixtures__/returning-user';

type Sidecar = {
  readonly burns: Readonly<Record<string, Readonly<Record<string, BurnMetrics>>>>;
  readonly tabSpans?: ReadonlyArray<Vec2>;
};

function fileText(name: string): string {
  return gunzipSync(readFileSync(resolve(FOLDER, `${name}.lf2.gz`))).toString('utf8');
}

function sidecar(name: string): Sidecar {
  return JSON.parse(readFileSync(resolve(FOLDER, `${name}.burns.json`), 'utf8'));
}

/** Opens as File > Open does and returns the project and every toast it raised. */
function opened(name: string): { readonly project: Project; readonly toasts: string[] } {
  const toasts: string[] = [];
  const result = deserializeProject(fileText(name));
  if (result.kind !== 'ok') throw new Error(`${name} did not open: ${JSON.stringify(result)}`);
  // 1.0.29 wrote schema 21. Schema 22 (ADR-694) only adds an optional rotary
  // taper, so step 21 changes nothing in these files.
  expect(result.migratedFrom, name).toBe(21);
  expect(result.oldProjectBurn, name).toBeUndefined();
  const done = completeNativeProjectOpen(
    {
      setProject: useStore.getState().setProject,
      markLoaded: () => undefined,
      pushToast: (message) => toasts.push(message),
    },
    `${name}.lf2`,
    result,
  );
  expect(done).toBe(true);
  return { project: useStore.getState().project, toasts };
}

async function gcodeOf(project: Project, ids: ReadonlyArray<string> | null, recordIndex = 0) {
  const objects =
    ids === null
      ? project.scene.objects
      : project.scene.objects.filter((object) => ids.includes(object.id));
  const prepared = await prepareOutputSnapshot(
    { ...project, scene: { ...project.scene, objects } },
    {
      clock: () => new Date('2026-11-02T00:00:00Z'),
      renderVariableText,
      recordIndex,
      // The CNC projects hold User Origin, which needs no live position.
      ...(project.machine?.kind === 'cnc'
        ? { jobOrigin: project.jobSetup.placement as JobOriginPlacement }
        : {}),
    },
  );
  if (!prepared.ok) throw new Error(`output of ${ids?.join(', ') ?? 'the job'} was refused`);
  return emitPreparedGcode(prepared).gcode;
}

function expectSameBurn(actual: BurnMetrics, wanted: BurnMetrics | undefined, label: string) {
  if (wanted === undefined) throw new Error(`no sidecar burn for ${label}`);
  for (const key of ['width', 'height', 'minX', 'minY', 'length', 'dose'] as const)
    expect(actual[key], `${label} ${key}`).toBeCloseTo(wanted[key], 2);
}

/** Every object alone, per CSV record for a variable text, as the sidecar was measured. */
async function expectBurnsAsSaved(project: Project, name: string): Promise<void> {
  const { burns } = sidecar(name);
  const records = (project.variables?.csv?.records ?? []).map((row) => row[0] ?? '');
  for (const object of project.scene.objects) {
    const measured = burns[object.id];
    if (object.kind === 'text' && object.variableTemplate !== undefined) {
      for (const [index, record] of records.entries())
        expectSameBurn(
          burnMetrics(await gcodeOf(project, [object.id], index)),
          measured?.[record],
          `${name} ${object.id} ${record}`,
        );
    } else {
      expectSameBurn(
        burnMetrics(await gcodeOf(project, [object.id])),
        measured?.['as-placed'],
        `${name} ${object.id}`,
      );
    }
  }
}

function textById(project: Project, id: string): TextObject {
  const text = project.scene.objects.find((object) => object.id === id);
  if (text?.kind !== 'text') throw new Error(`no text ${id}`);
  return text;
}

beforeEach(() => {
  resetStore();
  pushProjectLoadNotices({}, () => undefined, { migration: false });
});

describe('a laser project saved by 1.0.29', () => {
  it.each([
    '1.0.29-unaffected',
    '1.0.29-repaired-frames',
    '1.0.29-line-rule-frames',
    '1.0.29-placed-tabs',
    '1.0.29-fill-pool',
    '1.0.29-photo-recipe',
  ])('%s opens with only "Opened" and burns what 1.0.29 burned', async (name) => {
    const { project, toasts } = opened(name);
    expect(toasts).toHaveLength(1);
    expect(oldProjectBurnReviewWarnings(project)).toEqual([]);
    await expectBurnsAsSaved(project, name);
  });
});

describe('text frames 1.0.29 saved (ADR-682 Amendments 1 and 3)', () => {
  it('a frame 1.0.29 repaired at open keeps the line rule it was given back', async () => {
    const { project } = opened('1.0.29-repaired-frames');
    expect(textById(project, 'relief-tag').textBox?.legacyLineEm).toBe(0.68);
    expect(textById(project, 'casual-tag').textBox?.legacyLineEm).toBe(0.5);
    // ANNA in the Relief 80 x 11 frame, at its 1.0.27 size, not 29.612 x 7.480.
    const anna = burnMetrics(await gcodeOf(project, ['relief-tag'], 0));
    expect(anna.width).toBeCloseTo(39.588, 3);
    expect(anna.height).toBeCloseTo(10, 3);
    // The frames whose file cannot say stay under the em rule.
    for (const id of ['decorous-roomy-tag', 'nixish-narrow-tag', 'relief-plain-roomy'])
      expect(textById(project, id).textBox?.legacyLineEm, id).toBeUndefined();
  });

  it('every single-line frame 1.0.29 edited keeps its line rule; outline fonts have none', () => {
    const { project } = opened('1.0.29-line-rule-frames');
    for (const object of project.scene.objects) {
      const text = textById(project, object.id);
      const rule =
        text.fontKey === 'roboto-regular'
          ? undefined
          : text.fontKey.startsWith('ems-')
            ? 0.5
            : 0.68;
      expect(text.textBox?.legacyLineEm, object.id).toBe(rule);
    }
  });

  it('an edit on this build keeps the 1.0.27 size of a frame 1.0.29 edited', async () => {
    const { project } = opened('1.0.29-line-rule-frames');
    const plain = textById(project, 'relief-plain');
    const rebuilt = await buildTextObject({ ...plain, mode: 'edit' }, dialogValues(plain));
    expect(rebuilt.textBox?.legacyLineEm).toBe(0.68);
    expect(rebuilt.bounds.maxX - rebuilt.bounds.minX).toBeCloseTo(39.588, 3);
    expect(rebuilt.bounds.maxY - rebuilt.bounds.minY).toBeCloseTo(10, 3);
  });
});

describe('tabs placed by hand, then resized on 1.0.29 (ADR-494 Amendment 3)', () => {
  it('burns its tabs where 1.0.29 burned them', () => {
    const { project } = opened('1.0.29-placed-tabs');
    const wanted = sidecar('1.0.29-placed-tabs').tabSpans ?? [];
    const sorted = (points: ReadonlyArray<Vec2>) =>
      [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    const spans = sorted(burnedTabSpans(project));
    expect(spans).toHaveLength(wanted.length);
    sorted(wanted).forEach((point, index) => {
      const span = spans[index] as Vec2;
      expect(Math.hypot(span.x - point.x, span.y - point.y)).toBeLessThan(0.003);
    });
    // The toolbar doubled the 100 x 50 part: its edge tabs went where the
    // stretch put them, (300, 125) and (200, 150) on the canvas.
    expect(wanted).toContainEqual({ x: 300, y: 275 });
    expect(wanted).toContainEqual({ x: 200, y: 250 });
  });
});

describe('a Fill pool saved by 1.0.29 (ADR-683 Amendment 2)', () => {
  it('burns the pool even-odd: the circle is a hole in the square', async () => {
    const { project } = opened('1.0.29-fill-pool');
    const { burns } = sidecar('1.0.29-fill-pool');
    const job = burnMetrics(await gcodeOf(project, null));
    expectSameBurn(job, burns['whole-job']?.['as-placed'], 'whole job');
    // Each object alone fills solid; together the pool leaves the circle out.
    const alone = ['pool-outer', 'pool-hole', 'other-operation'].reduce(
      (sum, id) => sum + (burns[id]?.['as-placed']?.dose ?? NaN),
      0,
    );
    const hole = burns['pool-hole']?.['as-placed']?.dose ?? NaN;
    expect(job.dose).toBeCloseTo(alone - 2 * hole, -4);
  });
});

describe('photo recipes with Auto tones saved by 1.0.29 (ADR-685)', () => {
  it('keeps the recipe on each photo, not on its operation', () => {
    const { project } = opened('1.0.29-photo-recipe');
    for (const [id, negative] of [
      ['wood-portrait', false],
      ['slate-portrait', true],
    ] as const) {
      const image = project.scene.objects.find((object) => object.id === id);
      if (image?.kind !== 'raster-image') throw new Error(`no photo ${id}`);
      expect(image.contrast, id).toBeGreaterThan(0);
      expect(image.sharpenAmount, id).toBe(30);
      const override = Object.values(image.operationOverride?.byOperation ?? {})[0];
      expect(override?.ditherAlgorithm, id).toBe('blue-noise');
      expect(override?.negativeImage, id).toBe(negative);
    }
  });
});

// The CNC Job Origin counts crossing loops and flat Drill contours since
// 1.0.29 (ADR-327 Amendments 1 and 2). A project 1.0.29 saved already cut
// there, so it opens silently and cuts where 1.0.29 cut it.
describe('a CNC job saved by 1.0.29 (ADR-327 Amendment 2)', () => {
  const CUTS: Readonly<Record<string, CncCutExtent>> = JSON.parse(
    readFileSync(resolve(FOLDER, '1.0.29-cnc-job-origin.cuts.json'), 'utf8'),
  ).cuts;

  it.each(['1.0.29-cnc-bowtie-pocket', '1.0.29-cnc-flat-drill'])(
    '%s cuts where 1.0.29 cut it and says nothing about a move',
    async (name) => {
      const { project, toasts } = opened(name);
      expect(toasts.find((toast) => toast.includes('This CNC job now cuts'))).toBeUndefined();
      expect(oldProjectBurnReviewWarnings(project)).toEqual([]);
      const cut = cncCutExtent(await gcodeOf(project, null));
      const wanted = CUTS[name];
      if (wanted === undefined) throw new Error(`no sidecar for ${name}`);
      for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const)
        expect(cut[key], `${name} ${key}`).toBeCloseTo(wanted[key], 2);
    },
  );

  it('the bowtie Pocket at front-left starts one bit radius from work zero', () => {
    // 1.0.28 cut the same job from 58 mm left of work zero.
    expect(CUTS['1.0.29-cnc-bowtie-pocket']?.minX).toBeCloseTo(1.588, 3);
    expect(CUTS['1.0.29-cnc-bowtie-pocket']?.minY).toBeCloseTo(1.588, 3);
  });
});

// What the text dialog starts from when it opens a text for editing.
function dialogValues(text: TextObject): DialogValues {
  return {
    content: text.content,
    fontKey: text.fontKey,
    sizeMm: text.sizeMm,
    alignment: text.alignment,
    lineHeight: text.lineHeight,
    letterSpacing: text.letterSpacing,
    bendDeg: text.bendDeg ?? 0,
    color: text.color,
    embeddedFonts: [],
    ...(text.weldOverlaps === undefined ? {} : { weldOverlaps: text.weldOverlaps }),
    ...(text.textBox === undefined ? {} : { textBox: text.textBox }),
    ...(text.variableTemplate === undefined ? {} : { variableTemplate: text.variableTemplate }),
  };
}
