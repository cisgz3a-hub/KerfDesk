// @vitest-environment node
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { browserFreeBuild, DESKTOP_TOOL_MESSAGE } from '../../scripts/browser-free-build';
import type { Polyline } from '../core/scene';
import type { vcarveMedialPasses } from '../core/cnc/vcarve-medial';
import type {
  prepareVCarveMedialWork,
  runVCarveMedialRegionTask,
  finalizeVCarveMedialWork,
} from '../core/cnc/vcarve-medial-work';
import type { VCarveOptions } from '../core/cnc/vcarve-plan';

type VCarveProbe = {
  readonly code: string;
  readonly modules: readonly string[];
  readonly plan: typeof vcarveMedialPasses;
  readonly prepare: typeof prepareVCarveMedialWork;
  readonly run: typeof runVCarveMedialRegionTask;
  readonly finish: typeof finalizeVCarveMedialWork;
};
const SOURCE: readonly Polyline[] = [
  {
    closed: true,
    points: [
      { x: 10, y: 10 },
      { x: 22, y: 10 },
      { x: 22, y: 14 },
      { x: 10, y: 14 },
    ],
  },
];
const OPTIONS: VCarveOptions = {
  tool: { id: 'v90', name: '90 degree V-bit', kind: 'v-bit', diameterMm: 6, tipAngleDeg: 90 },
  maxDepthMm: 3,
  depthPerPassMm: 1,
  resolutionMm: 0.25,
};

async function vcarveBundle(mode: string): Promise<VCarveProbe> {
  const result = await build({
    configFile: false,
    root: resolve('.'),
    mode,
    logLevel: 'silent',
    plugins: [
      browserFreeBuild(),
      {
        name: 'vcarve-build-probe',
        resolveId(id) {
          return id.endsWith('vcarve-build-probe') ? '\0vcarve-build-probe' : undefined;
        },
        load(id) {
          if (id !== '\0vcarve-build-probe') return undefined;
          return (
            'export { vcarveMedialPasses as plan } from ' +
            JSON.stringify(resolve('src/core/cnc/vcarve-medial.ts')) +
            ';' +
            'export { prepareVCarveMedialWork as prepare, runVCarveMedialRegionTask as run, finalizeVCarveMedialWork as finish } from ' +
            JSON.stringify(resolve('src/core/cnc/vcarve-medial-work.ts')) +
            ';'
          );
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      lib: { entry: 'vcarve-build-probe', name: 'vcarveProbe', formats: ['iife'] },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (output === undefined || !('output' in output))
    throw new Error('Missing V-carve build output');
  const chunk = output.output.find((item) => item.type === 'chunk');
  if (chunk?.type !== 'chunk') throw new Error('Missing V-carve JS chunk');
  const api = runInNewContext(chunk.code + '\nvcarveProbe;') as VCarveProbe;
  return { ...api, code: chunk.code, modules: Object.keys(chunk.modules) };
}

describe('production medial V-carve build boundaries', () => {
  it('keeps direct and worker planning unavailable in browser Free', async () => {
    const free = await vcarveBundle('production');
    expect(() => free.plan(SOURCE, OPTIONS)).toThrow(DESKTOP_TOOL_MESSAGE);
    expect(() => free.prepare(SOURCE, OPTIONS)).toThrow(DESKTOP_TOOL_MESSAGE);
    expect(() => free.run({} as Parameters<typeof free.run>[0])).toThrow(DESKTOP_TOOL_MESSAGE);
    expect(() => free.finish({} as Parameters<typeof free.finish>[0], [])).toThrow(
      DESKTOP_TOOL_MESSAGE,
    );
    expect(free.code).not.toContain('planUnrankedVCarveMedialRegion');
    expect(free.modules.some((path) => path.includes('.test-support.'))).toBe(false);
  }, 30_000);

  it('retains identical direct and worker executable plans in desktop without the retired ladder', async () => {
    const desktop = await vcarveBundle('desktop');
    const work = desktop.prepare(SOURCE, OPTIONS);
    expect(work.kind).toBe('regions');
    if (work.kind !== 'regions') throw new Error('Expected region work for a real V-bit');
    const distributed = desktop.finish(work, work.tasks.map(desktop.run));
    expect(distributed).toEqual(desktop.plan(SOURCE, OPTIONS));
    expect(distributed.passes.length).toBeGreaterThan(0);
    expect(distributed.passes.every((pass) => pass.kind === 'path3d')).toBe(true);
    expect(distributed.offsetFailed).toBe(false);
    expect(desktop.code).toContain('planUnrankedVCarveMedialRegion');
    expect(desktop.modules.some((path) => path.includes('.test-support.'))).toBe(false);
  }, 30_000);
});
