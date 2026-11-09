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

// Rolling audit v10 V2-P2-1 (ADR-686 Amendment 2). `1.0.29-white-logos` was
// saved by the published 1.0.29 (`df2279e26`) through its own parseSvg, store
// Import and prepareProjectForPersistence, and measured there (README):
// - logo.svg: U3's black badge with a white diamond;
// - plate.svg: white letters on a black plate;
// - styled.svg: white written in a style attribute and a CSS class;
// - workaround.svg: the logo again, its white operation's Output off.
// Opening it on this build changes no burn and names the 5 burning white
// shapes (the workaround's is left out). Leave white unburned then burns what
// the same files imported on this build burn, and one Undo returns 1.0.29's.
const FOLDER = 'src/__fixtures__/returning-user';
const NAME = '1.0.29-white-logos';

const DIAMOND = 'M14 20 L20 12 L26 20 L20 28 Z';
const SOURCES = [
  [
    'logo.svg',
    0,
    `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">
  <circle cx="20" cy="20" r="15" fill="#000"/>
  <path d="${DIAMOND}" fill="#fff"/>
</svg>`,
  ],
  [
    'plate.svg',
    6,
    `<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="20mm" viewBox="0 0 60 20">
  <rect x="0" y="0" width="60" height="20" fill="#000000"/>
  <path d="M5 4 H13 V7 H8 V9 H12 V12 H8 V16 H5 Z" fill="#FFFFFF"/>
  <path d="M16 4 H19 V13 H24 V16 H16 Z" fill="#FFFFFF"/>
</svg>`,
  ],
  [
    'styled.svg',
    12,
    `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">
  <defs><style>.k{fill:#231f20}.w{fill:#ffffff}</style></defs>
  <circle class="k" cx="20" cy="20" r="15"/>
  <path style="fill:#FFFFFF" d="${DIAMOND}"/>
  <rect class="w" x="18" y="30" width="4" height="3"/>
</svg>`,
  ],
] as const;

type Burns = Readonly<Record<string, BurnMetrics>>;

function sidecar(): Burns {
  return JSON.parse(readFileSync(resolve(FOLDER, `${NAME}.burns.json`), 'utf8')).burns;
}

function opened(): { readonly project: Project; readonly toasts: string[] } {
  const toasts: string[] = [];
  const text = gunzipSync(readFileSync(resolve(FOLDER, `${NAME}.lf2.gz`))).toString('utf8');
  const result = deserializeProject(text);
  if (result.kind !== 'ok') throw new Error(`${NAME} did not open`);
  expect(result.migratedFrom).toBeUndefined();
  const done = completeNativeProjectOpen(
    {
      setProject: useStore.getState().setProject,
      markLoaded: () => undefined,
      pushToast: (message) => toasts.push(message),
    },
    `${NAME}.lf2`,
    result,
  );
  expect(done).toBe(true);
  return { project: useStore.getState().project, toasts };
}

async function burnOf(project: Project, source: string | null): Promise<BurnMetrics> {
  const objects =
    source === null
      ? project.scene.objects
      : project.scene.objects.filter((object) => object.svgImport?.source === source);
  const prepared = await prepareOutputSnapshot(
    { ...project, scene: { ...project.scene, objects } },
    { clock: () => new Date('2026-11-08T00:00:00Z'), renderVariableText },
  );
  if (!prepared.ok) throw new Error(`output of ${source ?? 'the job'} was refused`);
  return burnMetrics(emitPreparedGcode(prepared).gcode);
}

function expectSameBurn(actual: BurnMetrics, wanted: BurnMetrics | undefined, label: string) {
  if (wanted === undefined) throw new Error(`no burn for ${label}`);
  for (const key of ['width', 'height', 'minX', 'minY', 'length', 'dose'] as const)
    expect(actual[key], `${label} ${key}`).toBeCloseTo(wanted[key], 2);
}

/** The same SVGs imported on this build, at the positions 1.0.29 placed them. */
async function freshImportBurns(): Promise<Burns> {
  resetStore();
  for (const [source, batchIndex, svgText] of SOURCES) {
    const parsed = parseSvg({ svgText, id: source.replace('.svg', ''), source });
    if (parsed.fragment === undefined) throw new Error('Missing SVG fragment');
    const objects = parsed.fragment.entries.filter((entry) => entry.kind === 'imported-svg');
    useStore
      .getState()
      .importSvgFragment({ source, bounds: parsed.fragment.bounds, objects }, batchIndex);
  }
  const project = useStore.getState().project;
  const burns: Record<string, BurnMetrics> = {};
  for (const [source] of SOURCES) burns[source] = await burnOf(project, source);
  return burns;
}

beforeEach(resetStore);

describe('a logo saved by 1.0.29 with white shapes that burn', () => {
  it('opens unchanged, and the open notice and Job Review name the 5 burning white shapes', async () => {
    const { project, toasts } = opened();
    const saved = sidecar();
    for (const source of ['logo.svg', 'plate.svg', 'styled.svg', 'workaround.svg'])
      expectSameBurn(await burnOf(project, source), saved[source], source);
    expectSameBurn(await burnOf(project, null), saved['whole-job'], 'whole job');
    // Any later toast is the autosave hand-off cleanup, which has no store here.
    expect(toasts.slice(0, 2)).toEqual([
      `Opened ${NAME}.lf2`,
      'This project has 5 white shapes from an SVG import that burn over the darker fill under ' +
        'them, as KerfDesk 1.0.29 and earlier imported white. Its burn is unchanged. To leave ' +
        'the white unburned, choose Tools > Leave Imported White Unburned, or Leave white ' +
        'unburned in Job Review. One Undo burns the white again. A file saved before this ' +
        'version does not record see-through, gradient or masked white, so check the canvas ' +
        'afterwards.',
    ]);
    expect(burningWhiteReviewWarnings(project)).toEqual([
      'White in an imported logo burns: 5 white shapes from an SVG import burn over the darker ' +
        'fill under them, as KerfDesk 1.0.29 and earlier imported white. Use Leave white ' +
        'unburned to cut the white out; one Undo burns it again. A file saved before this ' +
        'version does not record see-through, gradient or masked white, so check the canvas ' +
        'afterwards.',
    ]);
  });

  it('burns what a fresh import burns after Leave white unburned, and one Undo returns 1.0.29’s', async () => {
    const fresh = await freshImportBurns();
    resetStore();
    opened();
    const saved = sidecar();
    expect(useStore.getState().leaveSavedWhiteUnburned()).toBe(5);
    const knocked = useStore.getState().project;
    for (const [source] of SOURCES) {
      expectSameBurn(await burnOf(knocked, source), fresh[source], `${source} left unburned`);
      expect((await burnOf(knocked, source)).length).toBeLessThan(saved[source]?.length ?? 0);
    }
    // U3's workaround already burned right; its white operation is untouched.
    expectSameBurn(await burnOf(knocked, 'workaround.svg'), saved['workaround.svg'], 'workaround');
    expect(burningWhiteReviewWarnings(knocked)).toEqual([]);

    useStore.getState().undo();
    const undone = useStore.getState().project;
    expectSameBurn(await burnOf(undone, null), saved['whole-job'], 'whole job after Undo');
    expect(burningWhiteReviewWarnings(undone)).toEqual([]);
  });
});
