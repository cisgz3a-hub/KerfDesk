import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { burnMetrics, type BurnMetrics } from '../../__fixtures__/returning-user/burn-metrics';
import type { Project } from '../../core/scene';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutputSnapshot } from '../../io/gcode/prepare-output-snapshot';
import { deserializeProject } from '../../io/project/deserialize-project';
import { parseSvg } from '../../io/svg/parse-svg';
import { completeNativeProjectOpen } from '../app/project-open-completion';
import { burningWhiteReviewWarnings } from '../state/saved-white-notice';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { renderVariableText } from './render-variable-text';

// Rolling audit v12 X2-P1-1 (ADR-686 Amendment 4). `1.0.29-white-logo-copies`
// was saved by the published 1.0.29 (`df2279e26`): U3's logo imported, two
// Array copies beside it, and a Duplicate moved below it (README). 1.0.29's
// copies drop `svgImport`, so only the original keeps it. Opening it names all
// 4 burning white shapes; Leave white unburned then leaves every copy burning
// what the same steps burn on this build, and one Undo returns 1.0.29's burn.
const FOLDER = 'src/__fixtures__/returning-user';
const NAME = '1.0.29-white-logo-copies';
const DIAMOND = 'M14 20 L20 12 L26 20 L20 28 Z';
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">
  <circle cx="20" cy="20" r="15" fill="#000"/>
  <path d="${DIAMOND}" fill="#fff"/>
</svg>`;

type Sidecar = {
  readonly withSvgImport: number;
  readonly burns: Readonly<Record<string, BurnMetrics>>;
};

function sidecar(): Sidecar {
  return JSON.parse(readFileSync(resolve(FOLDER, `${NAME}.burns.json`), 'utf8'));
}

function opened(): { readonly project: Project; readonly toasts: string[] } {
  const toasts: string[] = [];
  const text = gunzipSync(readFileSync(resolve(FOLDER, `${NAME}.lf2.gz`))).toString('utf8');
  const result = deserializeProject(text);
  if (result.kind !== 'ok') throw new Error(`${NAME} did not open`);
  const done = completeNativeProjectOpen(
    {
      setProject: useStore.getState().setProject,
      markLoaded: () => undefined,
      // One toast carries the result and its notes, one a line (ADR-708).
      pushToast: (message, _variant, options) =>
        toasts.push(...message.split('\n'), ...(options?.details ?? [])),
    },
    `${NAME}.lf2`,
    result,
  );
  expect(done).toBe(true);
  return { project: useStore.getState().project, toasts };
}

async function burnOf(project: Project, id: string | null): Promise<BurnMetrics> {
  const objects =
    id === null ? project.scene.objects : project.scene.objects.filter((o) => o.id === id);
  const prepared = await prepareOutputSnapshot(
    { ...project, scene: { ...project.scene, objects } },
    { clock: () => new Date('2026-11-09T00:00:00Z'), renderVariableText },
  );
  if (!prepared.ok) throw new Error(`output of ${id ?? 'the job'} was refused`);
  return burnMetrics(emitPreparedGcode(prepared).gcode);
}

function expectSameBurn(actual: BurnMetrics, wanted: BurnMetrics | undefined, label: string) {
  if (wanted === undefined) throw new Error(`no burn for ${label}`);
  for (const key of ['width', 'height', 'minX', 'minY', 'length', 'dose'] as const)
    expect(actual[key], `${label} ${key}`).toBeCloseTo(wanted[key], 2);
}

/** The same steps on this build, whose import already leaves the white out. */
async function freshBurns(): Promise<BurnMetrics[]> {
  resetStore();
  const parsed = parseSvg({ svgText: LOGO, id: 'logo', source: 'logo.svg' });
  if (parsed.fragment === undefined) throw new Error('Missing SVG fragment');
  const objects = parsed.fragment.entries.filter((entry) => entry.kind === 'imported-svg');
  useStore
    .getState()
    .importSvgFragment({ source: 'logo.svg', bounds: parsed.fragment.bounds, objects });
  const logo = useStore.getState().project.scene.objects[0];
  if (logo === undefined) throw new Error('no logo');
  useStore.setState({ selectedObjectId: logo.id, additionalSelectedIds: new Set() });
  useStore.getState().placeSelectionCopies([
    { dx: 0, dy: 0, rotationDeg: 0 },
    { dx: 45, dy: 0, rotationDeg: 0 },
    { dx: 90, dy: 0, rotationDeg: 0 },
  ]);
  useStore.setState({ selectedObjectId: logo.id, additionalSelectedIds: new Set() });
  useStore.getState().duplicateSelection();
  const id = useStore.getState().selectedObjectId;
  const copy = useStore.getState().project.scene.objects.find((object) => object.id === id);
  if (copy === undefined) throw new Error('no duplicate');
  useStore
    .getState()
    .applyObjectTransform(copy.id, { ...copy.transform, y: copy.transform.y - 50 });
  const project = useStore.getState().project;
  return Promise.all(project.scene.objects.map((object) => burnOf(project, object.id)));
}

beforeEach(resetStore);

describe('a logo saved by 1.0.29 with Array and Duplicate copies', () => {
  it('opens unchanged and names the white of every copy, not only the original', async () => {
    const { project, toasts } = opened();
    const saved = sidecar();
    expect(saved.withSvgImport).toBe(1);
    expect(project.scene.objects.filter((object) => object.svgImport !== undefined)).toHaveLength(
      1,
    );
    for (const object of project.scene.objects)
      expectSameBurn(await burnOf(project, object.id), saved.burns[object.id], object.id);
    expect(toasts[1]).toMatch(/^This project has 4 white shapes from an SVG import/);
    expect(burningWhiteReviewWarnings(project)[0]).toMatch(
      /^White in an imported logo burns: 4 white shapes/,
    );
  });

  it('leaves every copy burning what this build burns, and one Undo returns 1.0.29’s', async () => {
    const fresh = await freshBurns();
    resetStore();
    opened();
    const saved = sidecar();
    expect(useStore.getState().leaveSavedWhiteUnburned()).toBe(4);
    const knocked = useStore.getState().project;
    for (const [index, object] of knocked.scene.objects.entries()) {
      expectSameBurn(await burnOf(knocked, object.id), fresh[index], `copy ${index}`);
      expect((await burnOf(knocked, object.id)).length).toBeLessThan(
        saved.burns[object.id]?.length ?? 0,
      );
    }
    expect(burningWhiteReviewWarnings(knocked)).toEqual([]);

    useStore.getState().undo();
    const undone = useStore.getState().project;
    expectSameBurn(await burnOf(undone, null), saved.burns['whole-job'], 'whole job after Undo');
    expect(burningWhiteReviewWarnings(undone)).toEqual([]);
  });
});
