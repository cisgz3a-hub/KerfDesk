// @vitest-environment node
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { browserFreeBuild, DESKTOP_TOOL_MESSAGE } from '../../scripts/browser-free-build';
import { testAuthoringRelief } from '../__fixtures__/relief-authoring';
import { createLayer, DEFAULT_CNC_LAYER_SETTINGS, DEFAULT_CNC_MACHINE_CONFIG } from '../core/scene';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../core/devices';
import type { compileReliefGroupsForLayer } from '../core/cnc/compile-cnc-relief';
import type { reliefFinishingGroup } from '../core/cnc/compile-cnc-relief-finishing';
import type { compileReliefRestGroup } from '../core/cnc/compile-cnc-relief-rest';
import type { compileReliefProjectionGroups } from '../core/cnc/compile-cnc-relief-projection';
import type { reliefProjectionPlan } from '../core/relief/relief-projection-plan';
import type { predictReliefResidual } from '../core/relief/relief-residual-stock';
import type { reliefRestPasses } from '../core/relief/relief-rest-passes';
import type { Heightmap } from '../core/relief/heightmap';

type ReliefProbe = {
  readonly code: string;
  readonly rough: typeof compileReliefGroupsForLayer;
  readonly finishing: typeof reliefFinishingGroup;
  readonly rest: typeof compileReliefRestGroup;
  readonly projection: typeof compileReliefProjectionGroups;
  readonly projectionPlan: typeof reliefProjectionPlan;
  readonly residual: typeof predictReliefResidual;
  readonly restPaths: typeof reliefRestPasses;
};
const exportsByModule = {
  'core/cnc/compile-cnc-relief.ts': 'compileReliefGroupsForLayer as rough',
  'core/cnc/compile-cnc-relief-finishing.ts': 'reliefFinishingGroup as finishing',
  'core/cnc/compile-cnc-relief-rest.ts': 'compileReliefRestGroup as rest',
  'core/cnc/compile-cnc-relief-projection.ts': 'compileReliefProjectionGroups as projection',
  'core/relief/relief-projection-plan.ts': 'reliefProjectionPlan as projectionPlan',
  'core/relief/relief-residual-stock.ts': 'predictReliefResidual as residual',
  'core/relief/relief-rest-passes.ts': 'reliefRestPasses as restPaths',
};
async function reliefBundle(mode: string): Promise<ReliefProbe> {
  const result = await build({
    configFile: false,
    root: resolve('.'),
    mode,
    logLevel: 'silent',
    plugins: [
      browserFreeBuild(),
      {
        name: 'relief-build-probe',
        resolveId(id) {
          return id.endsWith('relief-build-probe') ? '\0relief-build-probe' : undefined;
        },
        load(id) {
          if (id !== '\0relief-build-probe') return undefined;
          return Object.entries(exportsByModule)
            .map(
              ([path, names]) =>
                'export { ' + names + ' } from ' + JSON.stringify(resolve('src', path)) + ';',
            )
            .join('\n');
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      lib: { entry: 'relief-build-probe', name: 'reliefProbe', formats: ['iife'] },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (output === undefined || !('output' in output)) throw new Error('Missing relief build output');
  const chunk = output.output.find((item) => item.type === 'chunk');
  if (chunk?.type !== 'chunk') throw new Error('Missing relief JS chunk');
  const api = runInNewContext(chunk.code + '\nreliefProbe;', {
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
  }) as ReliefProbe;
  return { ...api, code: chunk.code };
}
function fixture() {
  const relief = testAuthoringRelief();
  const machine = {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    toolId: 'rough',
    tools: [
      { id: 'rough', name: 'Rough', kind: 'end-mill' as const, diameterMm: 1.5 },
      { id: 'finish', name: 'Finish', kind: 'ball-nose' as const, diameterMm: 1 },
      { id: 'rest', name: 'Rest', kind: 'ball-nose' as const, diameterMm: 0.5 },
    ],
  };
  const layer = createLayer({ id: 'relief-layer', color: relief.color });
  const settings = {
    ...DEFAULT_CNC_LAYER_SETTINGS,
    toolId: 'rough',
    reliefFinishToolId: 'finish',
    reliefRestFinishToolId: 'rest',
    reliefScallopMm: 0.05,
    reliefRestScallopMm: 0.02,
    reliefRestResidualMm: 0,
  };
  const map: Heightmap = {
    widthCells: 2,
    heightCells: 2,
    widthMm: 2,
    heightMm: 2,
    mmPerCell: 1,
    depth: new Float32Array([-1, -1, -1, -1]),
  };
  return { relief, machine, layer, settings, map };
}
describe('moved relief browser-Free build boundaries', () => {
  it('strips every relief machining stage and direct new algorithm entry from browser bundles', async () => {
    const free = await reliefBundle('production');
    const { relief, layer, settings, machine, map } = fixture();
    const calls = [
      () => free.rough([relief], layer, settings, DEFAULT_DEVICE_PROFILE, machine),
      () => free.finishing([relief], layer, settings, DEFAULT_DEVICE_PROFILE, machine, []),
      () => free.rest([], layer, settings, DEFAULT_DEVICE_PROFILE, machine),
      () => free.projection([relief], layer, settings, DEFAULT_DEVICE_PROFILE, machine, []),
      () => free.projectionPlan(map, [], machine.tools[2]!, 0.2, 0.1),
      () => free.residual(map, [], machine.tools[1]!, 0.1),
      () => free.restPaths(map, [], new Uint8Array(4), 0.25),
    ];
    for (const call of calls) expect(call).toThrow(DESKTOP_TOOL_MESSAGE);
    expect(free.code).not.toContain('stampUpperStock');
    expect(free.code).not.toContain('sampledPath');
  }, 30_000);
  it('retains working finishing, rest and projection implementations in desktop bundles', async () => {
    const desktop = await reliefBundle('desktop');
    const { relief, layer, settings, machine, map } = fixture();
    const result = desktop.rough([relief], layer, settings, DEFAULT_DEVICE_PROFILE, machine);
    if (result.kind !== 'compiled') throw new Error(result.reason);
    expect(result.groups.some((group) => group.cutType === 'relief-rough')).toBe(true);
    expect(
      result.groups.some((group) => group.cutType === 'relief-finish' && group.toolId === 'finish'),
    ).toBe(true);
    expect(result.evidence.plans.map((plan) => plan.stage)).toEqual([
      'roughing',
      'finishing',
      'rest-finishing',
    ]);
    const projectionSettings = {
      ...settings,
      cutType: 'engrave' as const,
      toolId: 'rest',
      reliefProjection: {
        reliefObjectId: relief.id,
        depthMm: 0.2,
        depthConvention: 'vertical' as const,
        sampleSpacingMm: 0.1,
      },
    };
    const projected = desktop.projection(
      [relief],
      layer,
      projectionSettings,
      DEFAULT_DEVICE_PROFILE,
      machine,
      [
        {
          closed: false,
          points: [
            { x: 1.5, y: 1.5 },
            { x: 2.5, y: 1.5 },
          ].map((point) => toMachineCoords(point, DEFAULT_DEVICE_PROFILE)),
        },
      ],
    );
    if (projected.kind !== 'compiled') throw new Error(projected.reason);
    expect(projected.groups).toHaveLength(1);
    expect(projected.groups[0]?.passes[0]?.kind).toBe('path3d');
    expect(projected.plans[0]).toMatchObject({ stage: 'projection', verticalDepthMm: 0.2 });
    const residual = desktop.residual(map, [], machine.tools[1]!, 0.1);
    expect(residual.selectedCells).toBe(4);
    const rest = desktop.restPaths(
      map,
      [
        {
          kind: 'path3d',
          closed: false,
          points: [
            { x: 0.5, y: 0.5, z: -1 },
            { x: 1.5, y: 0.5, z: -1 },
          ],
        },
      ],
      residual.selected,
      0.25,
    );
    expect(rest.passes.length).toBeGreaterThan(0);
    expect(desktop.code).toContain('stampUpperStock');
    expect(desktop.code).toContain('sampledPath');
  }, 30_000);
});
