// ADR-598 Amendment 4 (performance audit S4-P3-2): Save G-code of an unchanged
// project reuses the program it just prepared, and nothing else.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { everydayMixedDesign } from '../../__fixtures__/everyday-mixed-design';
import type * as GcodeModule from '../../io/gcode';
import type * as VariableTemplateModule from '../../core/variables/object-variable-template';
import type { PlatformAdapter } from '../../platform/types';
import type * as OutputWorkerModule from '../laser/output-preparation-worker-client';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';

const counts = vi.hoisted(() => ({ direct: 0, background: 0 }));
const timeBound = vi.hoisted(() => ({ on: false }));

vi.mock('../../core/variables/object-variable-template', async (importOriginal) => {
  const actual = await importOriginal<typeof VariableTemplateModule>();
  return {
    ...actual,
    projectHasVariableData: (project: Parameters<typeof actual.projectHasVariableData>[0]) =>
      timeBound.on || actual.projectHasVariableData(project),
  };
});

vi.mock('../../io/gcode', async (importOriginal) => {
  const actual = await importOriginal<typeof GcodeModule>();
  return {
    ...actual,
    prepareOutputSnapshot: (...args: Parameters<typeof actual.prepareOutputSnapshot>) => {
      counts.direct += 1;
      return actual.prepareOutputSnapshot(...args);
    },
  };
});

vi.mock('../laser/output-preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof OutputWorkerModule>()),
  prepareSaveOutputOffThread: () => {
    counts.background += 1;
    return Promise.resolve({
      kind: 'emitted',
      gcode: `; background ${counts.background}\n`,
      preflight: { ok: true, issues: [] },
      cncVCarveDepths: [],
    });
  },
}));

import { emitSaveGcode } from './save-gcode-emission';
import type { SaveGcodeCtx } from './file-actions';
import { resetSaveEmissionReuseForTests, saveEmissionRequestKey } from './save-emission-reuse';

const PLATFORM: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
};

function ctx(overrides: Partial<SaveGcodeCtx> = {}): SaveGcodeCtx {
  return {
    platform: PLATFORM,
    project: useStore.getState().project,
    savedName: null,
    pushToast: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  resetStore();
  resetSaveEmissionReuseForTests();
  useStore.setState({ project: everydayMixedDesign(4) });
  counts.direct = 0;
  counts.background = 0;
  timeBound.on = false;
});

describe('Save G-code reuses the last program of an unchanged project', () => {
  it('prepares once for two Saves, and hands back the same bytes', async () => {
    const first = await emitSaveGcode(ctx(), { ok: true });
    const second = await emitSaveGcode(ctx(), { ok: true });
    expect(counts.direct).toBe(1);
    expect(second).toBe(first);
    expect(first.kind).toBe('emitted');
    resetSaveEmissionReuseForTests();
    expect((await emitSaveGcode(ctx(), { ok: true })).gcode).toBe(first.gcode);
  });

  it('prepares again when anything the program reads changes', async () => {
    await emitSaveGcode(ctx(), { ok: true });
    await emitSaveGcode(ctx({ activeWcs: 'G55' }), { ok: true });
    await emitSaveGcode(ctx({ outputScope: { ...DEFAULT_SCOPE, cutSelectedGraphics: true } }), {
      ok: true,
    });
    expect(counts.direct).toBe(3);
    const edited = { ...everydayMixedDesign(4), notes: 'edited' };
    useStore.setState({ project: edited });
    await emitSaveGcode(ctx(), { ok: true });
    expect(counts.direct).toBe(4);
  });

  it('lets go of the program once the open project changes', async () => {
    const first = await emitSaveGcode(ctx(), { ok: true });
    const project = useStore.getState().project;
    useStore.setState({ project: { ...project } });
    useStore.setState({ project });
    // The same project object again, but the entry was already released.
    expect(await emitSaveGcode(ctx(), { ok: true })).not.toBe(first);
    expect(counts.direct).toBe(2);
  });

  it('never reuses a Save whose variable text reads the clock', async () => {
    timeBound.on = true;
    await emitSaveGcode(ctx(), { ok: true });
    await emitSaveGcode(ctx(), { ok: true });
    expect(counts.background).toBe(2);
    expect(counts.direct).toBe(0);
  });
});

describe('the Save request key', () => {
  it('keeps apart the values plain JSON merges', () => {
    expect(saveEmissionRequestKey({ x: -0 })).not.toBe(saveEmissionRequestKey({ x: 0 }));
    expect(saveEmissionRequestKey({ x: Number.NaN })).not.toBe(saveEmissionRequestKey({ x: null }));
    expect(saveEmissionRequestKey({ x: undefined })).not.toBe(saveEmissionRequestKey({}));
    expect(saveEmissionRequestKey({ x: Infinity })).not.toBe(
      saveEmissionRequestKey({ x: -Infinity }),
    );
    expect(saveEmissionRequestKey({ a: 1, b: [2] })).toBe(saveEmissionRequestKey({ a: 1, b: [2] }));
  });
});

const DEFAULT_SCOPE = {
  cutSelectedGraphics: false,
  useSelectionOrigin: false,
  selectedObjectIds: [],
};
