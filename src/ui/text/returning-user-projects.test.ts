import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { burnMetrics, type BurnMetrics } from '../../__fixtures__/returning-user/burn-metrics';
import type { Project, TextObject } from '../../core/scene';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutputSnapshot } from '../../io/gcode/prepare-output-snapshot';
import { deserializeProject } from '../../io/project/deserialize-project';
import { prepareProjectForPersistence } from '../../io/project/prepare-project-persistence';
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

// Rolling audit v9 R7-P1-1 and R7-P3-2 (ADR-682 Amendment 3). Every file was saved
// by the real release its name says; see the folder's README.
const FOLDER = 'src/__fixtures__/returning-user';
const DIRECT = '1.0.27-text-frames';
const CHAIN = '1.0.27-text-frames-via-1.0.28';
const EDITED = '1.0.27-text-frames-edited-on-1.0.28';
const FRESH = '1.0.28-fresh-frames';
// The frames whose stored template the old rule drew and the em rule does not.
const RECOVERED = ['relief-tag', 'casual-tag', 'nixish-tag'];
// The em render of their template equals what is stored, so the file cannot say.
const CANNOT_TELL = ['decorous-roomy-tag', 'nixish-narrow-tag', 'relief-plain-roomy'];

type Burns = Readonly<Record<string, Readonly<Record<string, BurnMetrics>>>>;

function fileText(name: string): string {
  return gunzipSync(readFileSync(resolve(FOLDER, `${name}.lf2.gz`))).toString('utf8');
}

function sidecar(name: string): Burns {
  return JSON.parse(readFileSync(resolve(FOLDER, `${name}.burns.json`), 'utf8')).burns;
}

function opened(json: string) {
  const result = deserializeProject(json);
  if (result.kind !== 'ok') throw new Error(`did not open: ${JSON.stringify(result)}`);
  const load = useStore.getState().setProject(result.project);
  if (load.kind === 'job-machine-locked' || load.kind === 'desktop-required')
    throw new Error(load.kind);
  return { ...result, project: useStore.getState().project };
}

function textById(project: Project, id: string): TextObject {
  const text = project.scene.objects.find((object) => object.id === id);
  if (text?.kind !== 'text') throw new Error(`no text ${id}`);
  return text;
}

async function gcodeOf(project: Project, id: string, recordIndex: number): Promise<string> {
  const object = project.scene.objects.find((candidate) => candidate.id === id);
  if (object === undefined) throw new Error(`no object ${id}`);
  const prepared = await prepareOutputSnapshot(
    { ...project, scene: { ...project.scene, objects: [object] } },
    { clock: () => new Date('2026-11-02T00:00:00Z'), renderVariableText, recordIndex },
  );
  if (!prepared.ok) throw new Error(`output of ${id} was refused`);
  return emitPreparedGcode(prepared).gcode;
}

function expectSameSize(actual: BurnMetrics, wanted: BurnMetrics | undefined, label: string): void {
  expect(actual.width, `${label} width`).toBeCloseTo(wanted?.width ?? NaN, 2);
  expect(actual.height, `${label} height`).toBeCloseTo(wanted?.height ?? NaN, 2);
}

function recordNames(project: Project): ReadonlyArray<string> {
  return (project.variables?.csv?.records ?? []).map((row) => row[0] ?? '');
}

beforeEach(resetStore);

describe('a 1.0.27 project saved through 1.0.28 (R7-P1-1)', () => {
  it('burns ANNA 39.588 x 10.000 mm in the Relief 80 x 11 frame, not 29.612 x 7.480', async () => {
    const { project } = opened(fileText(CHAIN));
    const burn = burnMetrics(await gcodeOf(project, 'relief-tag', 0));
    expect(burn.width).toBeCloseTo(39.588, 3);
    expect(burn.height).toBeCloseTo(10, 3);
  });

  it.each(RECOVERED)('%s gets its line rule back and burns as a direct open', async (id) => {
    const chain = opened(fileText(CHAIN)).project;
    const direct = opened(fileText(DIRECT)).project;
    expect(textById(chain, id).textBox?.legacyLineEm).toBe(
      textById(direct, id).textBox?.legacyLineEm,
    );
    expect(textById(chain, id).textBox?.legacyLineEm).toBeGreaterThan(0);
    // Byte for byte, so the Casual Hand records that moved a further 2.7 mm on
    // the em rule are back where a direct open puts them.
    for (const [index] of recordNames(chain).entries())
      expect(await gcodeOf(chain, id, index)).toBe(await gcodeOf(direct, id, index));
  });

  it('burns every recovered record at the size 1.0.27 measured', async () => {
    const { project } = opened(fileText(CHAIN));
    const measured = sidecar(DIRECT);
    for (const id of RECOVERED)
      for (const [index, name] of recordNames(project).entries())
        expectSameSize(
          burnMetrics(await gcodeOf(project, id, index)),
          measured[id]?.[name],
          `${id} ${name}`,
        );
  });

  it('recovers a plain frame, so an edit keeps its 1.0.27 size', async () => {
    const plain = textById(opened(fileText(CHAIN)).project, 'relief-plain');
    expect(plain.textBox?.legacyLineEm).toBe(0.68);
    const rebuilt = await buildTextObject({ ...plain, mode: 'edit' }, dialogValues(plain));
    expect(rebuilt.bounds.maxX - rebuilt.bounds.minX).toBeCloseTo(39.588, 3);
    expect(rebuilt.bounds.maxY - rebuilt.bounds.minY).toBeCloseTo(10, 3);
  });

  it('leaves frames it cannot place under the em rule', () => {
    const { project } = opened(fileText(CHAIN));
    for (const id of CANNOT_TELL)
      expect(textById(project, id).textBox?.legacyLineEm, id).toBeUndefined();
  });

  it('leaves outline fonts alone', () => {
    const { project } = opened(fileText(CHAIN));
    expect(textById(project, 'roboto-tag').textBox?.legacyLineEm).toBeUndefined();
  });

  it('repairs a schema-20 file the same way, since a build of main can have saved one', () => {
    const raw = JSON.parse(fileText(CHAIN));
    const { project } = opened(JSON.stringify({ ...raw, schemaVersion: 20 }));
    expect(textById(project, 'relief-tag').textBox?.legacyLineEm).toBe(0.68);
  });

  it('is settled once saved: the next open migrates nothing and says nothing', () => {
    const first = opened(fileText(CHAIN));
    expect(first.migratedFrom).toBe(19);
    const saved = prepareProjectForPersistence(first.project);
    if (saved.kind !== 'ok') throw new Error(saved.reason);
    const second = opened(saved.json);
    expect(second.migratedFrom).toBeUndefined();
    expect(second.oldProjectBurn).toBeUndefined();
    const again = prepareProjectForPersistence(second.project);
    if (again.kind !== 'ok') throw new Error(again.reason);
    expect(again.json).toBe(saved.json);
  });
});

describe('frames the repair must not touch (R7-P1-1)', () => {
  it('a 1.0.27 file opened directly burns as 1.0.27 and repairs nothing', async () => {
    const { project, oldProjectBurn } = opened(fileText(DIRECT));
    expect(oldProjectBurn?.repairedFrames).toEqual([]);
    expect(oldProjectBurn?.uncertainFrames).toEqual([]);
    const measured = sidecar(DIRECT);
    for (const [index, name] of recordNames(project).entries())
      expectSameSize(
        burnMetrics(await gcodeOf(project, 'relief-tag', index)),
        measured['relief-tag']?.[name],
        name,
      );
  });

  it('frames made on 1.0.28 at the new size keep the em rule and that size', async () => {
    const { project, oldProjectBurn } = opened(fileText(FRESH));
    expect(oldProjectBurn?.repairedFrames ?? []).toEqual([]);
    const measured = sidecar(FRESH);
    for (const object of project.scene.objects) {
      const text = textById(project, object.id);
      expect(text.textBox?.legacyLineEm, object.id).toBeUndefined();
      if (text.variableTemplate === undefined) continue;
      // Never up to the old rule's size. A record that would leave the frame on
      // the shared baseline refits a little smaller (ADR-682 Amendment 2).
      for (const [index, name] of recordNames(project).entries()) {
        const burn = burnMetrics(await gcodeOf(project, object.id, index));
        const was = measured[object.id]?.[name]?.width ?? NaN;
        expect(burn.width, `${object.id} ${name}`).toBeLessThanOrEqual(was + 0.01);
        expect(burn.width, `${object.id} ${name}`).toBeGreaterThan(was * 0.9);
      }
    }
    const name = measured['fresh-relief-new-size']?.['ANNA'];
    expect(name?.width).toBeCloseTo(29.612, 3);
  });

  it('frames rebuilt by an edit on 1.0.28 keep what that edit drew', async () => {
    const { project, oldProjectBurn } = opened(fileText(EDITED));
    expect(oldProjectBurn?.repairedFrames ?? []).toEqual([]);
    for (const id of [...RECOVERED, 'relief-plain'])
      expect(textById(project, id).textBox?.legacyLineEm, id).toBeUndefined();
    const burn = burnMetrics(await gcodeOf(project, 'relief-tag', 0));
    expect(burn.width).toBeCloseTo(29.612, 3);
    expect(burn.height).toBeCloseTo(7.48, 3);
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
