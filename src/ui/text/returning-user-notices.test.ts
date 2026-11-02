import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { burnMetrics, type BurnMetrics } from '../../__fixtures__/returning-user/burn-metrics';
import { createProject, type Project } from '../../core/scene';
import { createProductionManifest } from '../../core/scene/production-manifest';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutputSnapshot } from '../../io/gcode/prepare-output-snapshot';
import { deserializeProject } from '../../io/project/deserialize-project';
import { serializeProject } from '../../io/project/serialize-project';
import { parseProjectTemplateDocument } from '../../io/project/project-template';
import { completeNativeProjectOpen } from '../app/project-open-completion';
import { readAutosaveRecord, type AutosaveRecord } from '../state/autosave-record';
import { oldProjectBurnReviewWarnings } from '../state/old-project-burn-review';
import { pushProjectLoadNotices } from '../state/project-load-notices';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { renderVariableText } from './render-variable-text';

vi.mock('./font-loader', () => ({
  loadFont: async () => {
    const { readFile } = await import('node:fs/promises');
    return Uint8Array.from(await readFile('src/ui/text/fonts/Roboto-Regular.ttf')).buffer;
  },
}));

// Rolling audit v9 R7-P1-1, R7-P2-1 and R7-P2-2 (ADR-682 Amendment 3), read from
// projects the real releases saved.
const FOLDER = 'src/__fixtures__/returning-user';

function fileText(name: string): string {
  return gunzipSync(readFileSync(resolve(FOLDER, `${name}.lf2.gz`))).toString('utf8');
}

function sidecar(name: string): Readonly<Record<string, Readonly<Record<string, BurnMetrics>>>> {
  return JSON.parse(readFileSync(resolve(FOLDER, `${name}.burns.json`), 'utf8')).burns;
}

/** Opens as File > Open does and returns every toast it raised. */
function openToasts(name: string): ReadonlyArray<string> {
  const toasts: string[] = [];
  const opened = completeNativeProjectOpen(
    {
      setProject: useStore.getState().setProject,
      markLoaded: () => undefined,
      pushToast: (message) => toasts.push(message),
    },
    `${name}.lf2`,
    deserializeProject(fileText(name)),
  );
  expect(opened).toBe(true);
  return toasts;
}

async function burnOf(project: Project, id: string, recordIndex = 0): Promise<BurnMetrics> {
  const object = project.scene.objects.find((candidate) => candidate.id === id);
  if (object === undefined) throw new Error(`no object ${id}`);
  const prepared = await prepareOutputSnapshot(
    { ...project, scene: { ...project.scene, objects: [object] } },
    { clock: () => new Date('2026-11-02T00:00:00Z'), renderVariableText, recordIndex },
  );
  if (!prepared.ok) throw new Error(`output of ${id} was refused`);
  return burnMetrics(emitPreparedGcode(prepared).gcode);
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
  pushProjectLoadNotices({}, () => undefined, { migration: false });
});

describe('the notice at open', () => {
  it('names the repaired text and both sizes (R7-P1-1)', () => {
    const toasts = openToasts('1.0.27-text-frames-via-1.0.28');
    const repaired = toasts.find((toast) => toast.includes('refitted'));
    expect(repaired).toContain(
      '“{{csv:name}}”: “ANNA” goes from 29.61 × 7.48 mm back to 39.59 × 10.00 mm',
    );
    expect(repaired).toContain('lower Size');
  });

  it('warns where the frame could be either, with both sizes (R7-P1-1)', () => {
    const toasts = openToasts('1.0.27-text-frames-via-1.0.28');
    const uncertain = toasts.find((toast) => toast.includes('cannot show'));
    expect(uncertain).toContain('“ANNA” burns 47.46 × 10.27 mm now and burned 63.28 × 13.70 mm');
  });

  it('keeps the three visible toasts: Opened and at most two more', () => {
    const toasts = openToasts('1.0.27-whole-job');
    expect(toasts.length).toBeLessThanOrEqual(3);
  });

  it('says variable records can move, naming them (R7-P2-1)', () => {
    const direct = openToasts('1.0.27-whole-job').join(' ');
    expect(direct).toContain("follows its template's baseline");
    expect(direct).toContain('“{{csv:name}}”');
  });

  it('says images burn more from a file older than schema 19 (R7-P2-2)', () => {
    const direct = openToasts('1.0.27-whole-job').join(' ');
    expect(direct).toContain('“grayscale-dot-width.png” burns darker');
    expect(direct).toContain('“turned-pass-through.png” burns darker');
  });

  it('does not repeat the image change to a project 1.0.28 already saved (R7-P2-2)', () => {
    const chain = openToasts('1.0.27-whole-job-via-1.0.28').join(' ');
    expect(chain).not.toContain('burns darker');
  });

  it.each(['1.0.27-unaffected', '1.0.28-unaffected'])(
    'stays silent for %s, which burns as before',
    (name) => {
      expect(openToasts(name)).toHaveLength(1);
      expect(oldProjectBurnReviewWarnings(useStore.getState().project)).toEqual([]);
    },
  );

  it('a project at the current schema is silent', () => {
    const toasts: string[] = [];
    pushProjectLoadNotices({}, (message) => toasts.push(message), { migration: false });
    expect(toasts).toEqual([]);
  });
});

describe('every reader of an old file gets the notice', () => {
  const CHAIN = '1.0.27-text-frames-via-1.0.28';

  it('New from template', () => {
    const contents = JSON.stringify({
      format: 'kerfdesk-project-template',
      version: 1,
      projectJson: fileText(CHAIN),
    });
    const { notices } = parseProjectTemplateDocument(contents);
    expect(notices.oldProjectBurn?.repairedFrames.length).toBeGreaterThan(0);
  });

  it('autosave recovery', () => {
    const record = { projectJson: fileText(CHAIN), savedAt: 1 } as AutosaveRecord;
    const read = readAutosaveRecord(record, 'key');
    if (read.kind !== 'ok') throw new Error(read.kind);
    expect(read.snapshot.loadNotices?.oldProjectBurn?.repairedFrames.length).toBeGreaterThan(0);
  });

  it('a sheet an earlier build archived, and the earlier review stays', () => {
    openToasts('1.0.27-whole-job');
    const before = oldProjectBurnReviewWarnings(useStore.getState().project);
    expect(before.length).toBeGreaterThan(0);
    const project = useStore.getState().project;
    useStore.getState().setProject({
      ...project,
      sheetBook: {
        activeId: 'one',
        activeName: 'One',
        inactive: [{ id: 'two', name: 'Two', projectJson: fileText(CHAIN) }],
      },
    });
    useToastStore.setState({ toasts: [] });
    expect(useStore.getState().switchProjectSheet('two')).toBe(true);
    const toasts = useToastStore.getState().toasts.map((toast) => toast.message);
    expect(toasts.join(' ')).toContain('goes from 29.61 × 7.48 mm back to 39.59 × 10.00 mm');
    expect(useStore.getState().switchProjectSheet('one')).toBe(true);
    expect(oldProjectBurnReviewWarnings(useStore.getState().project).length).toBeGreaterThan(0);
  });

  it('a frozen production design, read only at output', () => {
    const design = JSON.parse(fileText(CHAIN));
    const outer = { ...createProject(), variables: design.variables };
    let id = 0;
    const productionManifest = createProductionManifest(outer, {
      name: 'Old run',
      count: 1,
      now: new Date('2026-10-30T00:00:00.000Z'),
      designProjectJson: JSON.stringify(design),
      idFactory: () => String(++id),
    });
    const saved = JSON.parse(serializeProject({ ...outer, productionManifest }));
    const result = deserializeProject(JSON.stringify({ ...saved, schemaVersion: 19 }));
    if (result.kind !== 'ok') throw new Error(JSON.stringify(result));
    expect(result.oldProjectBurn?.repairedFrames.length).toBeGreaterThan(0);
  });
});

describe('Job Review repeats the notice while the project is open', () => {
  it('names the repair, the move and the image change', () => {
    openToasts('1.0.27-whole-job');
    const warnings = oldProjectBurnReviewWarnings(useStore.getState().project).join(' ');
    expect(warnings).toContain("follows its template's baseline");
    expect(warnings).toContain('burns darker');
  });

  it('drops an object that left the project, and a project that replaced it', () => {
    openToasts('1.0.27-text-frames-via-1.0.28');
    const project = useStore.getState().project;
    const warnings = oldProjectBurnReviewWarnings(project).join(' ');
    expect(warnings).toContain('refitted');
    const without = project.scene.objects.filter((object) => object.kind !== 'text');
    expect(
      oldProjectBurnReviewWarnings({ ...project, scene: { ...project.scene, objects: without } }),
    ).toEqual([]);
    expect(oldProjectBurnReviewWarnings(createProject())).toEqual([]);
  });
});

// R7-P3-2: no earlier test compared a whole job with what its saving release burned.
describe('a whole 1.0.27 job on this build', () => {
  const measured = sidecar('1.0.27-whole-job');
  const opened = (): Project => {
    openToasts('1.0.27-whole-job');
    return useStore.getState().project;
  };

  it('burns the Relief frame records at their 1.0.27 size', async () => {
    const project = opened();
    const anna = await burnOf(project, 'relief-tag', 0);
    const max = await burnOf(project, 'relief-tag', 1);
    expect(anna.width).toBeCloseTo(39.588, 2);
    expect(anna.height).toBeCloseTo(10, 2);
    expect(max.width).toBeCloseTo(measured['relief-tag']?.['Maximilian']?.width ?? NaN, 2);
    expect(max.height).toBeCloseTo(measured['relief-tag']?.['Maximilian']?.height ?? NaN, 2);
  });

  it('keeps a bent record at its size and moves it onto the baseline (ADR-682 D5)', async () => {
    const burn = await burnOf(opened(), 'roboto-bent', 0);
    const was = measured['roboto-bent']?.['ANNA'];
    expect(burn.width).toBeCloseTo(was?.width ?? NaN, 2);
    expect(Math.abs(burn.minX - (was?.minX ?? NaN))).toBeGreaterThan(1);
  });

  it.each(['tabbed-rectangle', 'stretched-sketch'])('burns %s unchanged', async (id) => {
    const burn = await burnOf(opened(), id);
    const was = measured[id]?.['as-placed'];
    expect(burn).toEqual(was);
  });

  it('burns more dose on the images, as ADR-458 and ADR-492 Amendment 1 decided', async () => {
    const project = opened();
    const dot = await burnOf(project, 'grayscale-dot-width');
    const turned = await burnOf(project, 'turned-pass-through');
    expect(dot.dose / (measured['grayscale-dot-width']?.['as-placed']?.dose ?? NaN)).toBeCloseTo(
      1.654,
      2,
    );
    expect(turned.dose / (measured['turned-pass-through']?.['as-placed']?.dose ?? NaN)).toBeCloseTo(
      1.376,
      2,
    );
  });

  it('cuts the near-closed CNC profile Outside, which preflight announces (ADR-672)', async () => {
    openToasts('1.0.27-cnc');
    const burn = await burnOf(useStore.getState().project, 'near-closed-profile');
    const was = sidecar('1.0.27-cnc')['near-closed-profile']?.['as-placed'];
    expect(burn.width).toBeCloseTo((was?.width ?? NaN) + 3.175, 2);
    expect(burn.height).toBeCloseTo((was?.height ?? NaN) + 4.762, 2);
  });
});
