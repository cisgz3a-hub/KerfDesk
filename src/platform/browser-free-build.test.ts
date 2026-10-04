// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS } from '../core/trace/trace-presets';
import type {
  CncLayerSettings,
  ImportedSvg,
  Scene,
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
} from '../core/scene';
import type { DEFAULT_DEVICE_PROFILE } from '../core/devices';
import type { compileCncJob } from '../core/cnc/compile-cnc-job';
import type { findCncOffsetLadderDiagnostics } from '../core/cnc/cnc-offset-ladder-diagnostics';
import {
  browserFreeBuild,
  DESKTOP_TOOL_MESSAGE,
  isBrowserFreeMode,
  PRO_BUILD_ENTRIES,
  replaceProEntryBodies,
  replaceProTracePresets,
} from '../../scripts/browser-free-build';

describe('browser Free build boundary', () => {
  it('defaults every shipped browser mode to Free; only desktop and tests keep Pro source', () => {
    expect(
      ['development', 'production', 'staging', 'preview', 'test'].map((mode) =>
        isBrowserFreeMode(mode),
      ),
    ).toEqual([true, true, true, true, true]);
    expect(isBrowserFreeMode('desktop')).toBe(false);
    expect(isBrowserFreeMode('test', 'serve')).toBe(false);
  });

  it('checks every explicit source boundary and refuses renamed implementations', () => {
    for (const path of Object.keys(PRO_BUILD_ENTRIES)) {
      const source = readFileSync(resolve(path), 'utf8');
      expect(replaceProEntryBodies(source, path)).not.toBe(source);
    }
    expect(() =>
      replaceProEntryBodies('export function renamed() {}', 'src/core/box/generate-box.ts'),
    ).toThrow('Pro build boundary changed');
    expect(() => replaceProTracePresets('export const TRACE_PRESETS = {};')).toThrow(
      'Free trace preset boundary changed',
    );
  });

  it('bundles a nonfunctional Pro entry in browser but a working box generator in desktop', async () => {
    const free = await boxBundle('production');
    expect(() => free.generateBox(boxSpec)).toThrow(DESKTOP_TOOL_MESSAGE);
    expect(free.code).not.toContain('buildPanelClaims');
    const desktop = await boxBundle('desktop');
    const generated = JSON.parse(JSON.stringify(desktop.generateBox(boxSpec))) as {
      kind: string;
      panels: unknown[];
    };
    expect(generated.kind).toBe('generated');
    expect(generated.panels).toHaveLength(6);
    expect(desktop.code).toContain('buildPanelClaims');
  });

  it('keeps only Line Art in browser Free and every preset in desktop', async () => {
    const probe = await traceBundle();
    const data = new Uint8ClampedArray(32 * 32 * 4).fill(255);
    for (let y = 8; y < 24; y++)
      for (let x = 8; x < 24; x++) {
        const offset = (y * 32 + x) * 4;
        data[offset] = data[offset + 1] = data[offset + 2] = 0;
      }
    const image = { width: 32, height: 32, data };
    expect(Object.keys(probe.presets)).toEqual(['Line Art']);
    expect((await probe.trace(image, probe.presets['Line Art'])).length).toBeGreaterThan(0);
    // Dedicated Pro backends cannot be reached with caller-supplied options.
    for (const preset of [
      'Centerline',
      'Photo shading',
      'Colour layers',
      'Line + fill',
      'Edge Detection',
    ])
      await expect(probe.trace(image, TRACE_PRESETS[preset])).rejects.toThrow(DESKTOP_TOOL_MESSAGE);
    const desktop = await traceBundle('desktop');
    expect(Object.keys(desktop.presets)).toEqual(Object.keys(TRACE_PRESETS));
    for (const options of Object.values(desktop.presets))
      expect(Array.isArray(await desktop.trace(image, options))).toBe(true);
  });

  it('compiles every Free CNC choice and diagnostics while rejecting Pro toolpaths', async () => {
    const probe = await cncBundle();
    const freeChoices: ReadonlyArray<Partial<CncLayerSettings>> = [
      { cutType: 'engrave' },
      { cutType: 'profile-outside' },
      { cutType: 'profile-inside' },
      { cutType: 'profile-on-path' },
      { cutType: 'drill' },
      { cutType: 'inlay-pair' },
      { cutType: 'pocket', pocketStrategy: 'offset' },
      { cutType: 'pocket', pocketStrategy: 'raster-x' },
      { cutType: 'pocket', pocketStrategy: 'raster-y' },
    ];
    for (const choice of freeChoices) {
      const scene = cncScene(probe, choice);
      const job = probe.compile(scene, probe.device, probe.machine);
      expect(job.groups.length, JSON.stringify(choice)).toBeGreaterThan(0);
      expect(
        job.groups.reduce(
          (count, group) => count + (group.kind === 'cnc' ? group.passes.length : 0),
          0,
        ),
        JSON.stringify(choice),
      ).toBeGreaterThan(0);
      expect(probe.diagnostics(scene, probe.device, probe.machine), JSON.stringify(choice)).toEqual(
        [],
      );
    }
    for (const choice of [
      { cutType: 'v-carve' },
      { cutType: 'pocket', pocketStrategy: 'adaptive' },
    ] as const) {
      const scene = cncScene(probe, choice);
      expect(() => probe.compile(scene, probe.device, probe.machine)).toThrow(DESKTOP_TOOL_MESSAGE);
    }
  });
});

const boxSpec = {
  widthMm: 60,
  depthMm: 40,
  heightMm: 30,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'closed',
  clearanceMm: 0,
  relief: { kind: 'none' },
  partSpacingMm: 8,
};

async function boxBundle(mode: string): Promise<{
  code: string;
  generateBox: (spec: typeof boxSpec) => unknown;
}> {
  const result = await build({
    configFile: false,
    root: resolve('.'),
    mode,
    logLevel: 'silent',
    plugins: [browserFreeBuild()],
    build: {
      write: false,
      target: 'es2022',
      minify: false,
      lib: {
        entry: resolve('src/core/box/generate-box.ts'),
        name: 'editionProbe',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (output === undefined || !('output' in output)) throw new Error('Missing build output');
  const chunk = output.output.find((item) => item.type === 'chunk');
  if (chunk?.type !== 'chunk') throw new Error('Missing JS chunk');
  const api = runInNewContext(`${chunk.code}\neditionProbe;`) as {
    generateBox: (spec: typeof boxSpec) => unknown;
  };
  return { code: chunk.code, generateBox: api.generateBox };
}

async function traceBundle(mode = 'production'): Promise<{
  trace: (image: unknown, options: unknown) => Promise<unknown[]>;
  presets: Record<string, unknown>;
}> {
  const result = await build({
    configFile: false,
    root: resolve('.'),
    mode,
    logLevel: 'silent',
    plugins: [
      browserFreeBuild(),
      {
        name: 'trace-build-probe',
        resolveId(id) {
          return id.endsWith('trace-build-probe') ? '\0trace-build-probe' : undefined;
        },
        load(id) {
          if (id !== '\0trace-build-probe') return undefined;
          return `export { traceImageToColoredPaths as trace } from ${JSON.stringify(resolve('src/core/trace/trace-to-paths.ts'))};
          export { TRACE_PRESETS as presets } from ${JSON.stringify(resolve('src/core/trace/trace-presets.ts'))};`;
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      lib: {
        entry: 'trace-build-probe',
        name: 'traceProbe',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (output === undefined || !('output' in output)) throw new Error('Missing trace build output');
  const chunk = output.output.find((item) => item.type === 'chunk');
  if (chunk?.type !== 'chunk') throw new Error('Missing trace JS chunk');
  return runInNewContext(`${chunk.code}\ntraceProbe;`) as Awaited<ReturnType<typeof traceBundle>>;
}

type CncProbe = {
  compile: typeof compileCncJob;
  diagnostics: typeof findCncOffsetLadderDiagnostics;
  createLayer: typeof createLayer;
  defaults: typeof DEFAULT_CNC_LAYER_SETTINGS;
  machine: typeof DEFAULT_CNC_MACHINE_CONFIG;
  transform: typeof IDENTITY_TRANSFORM;
  device: typeof DEFAULT_DEVICE_PROFILE;
};

async function cncBundle(): Promise<CncProbe> {
  const result = await build({
    configFile: false,
    root: resolve('.'),
    mode: 'production',
    logLevel: 'silent',
    plugins: [
      browserFreeBuild(),
      {
        name: 'cnc-build-probe',
        resolveId(id) {
          return id.endsWith('cnc-build-probe') ? '\0cnc-build-probe' : undefined;
        },
        load(id) {
          if (id !== '\0cnc-build-probe') return undefined;
          return `export { compileCncJob as compile } from ${JSON.stringify(resolve('src/core/cnc/compile-cnc-job.ts'))};
          export { findCncOffsetLadderDiagnostics as diagnostics } from ${JSON.stringify(resolve('src/core/cnc/cnc-offset-ladder-diagnostics.ts'))};
          export { DEFAULT_DEVICE_PROFILE as device } from ${JSON.stringify(resolve('src/core/devices/index.ts'))};
          export { createLayer, DEFAULT_CNC_LAYER_SETTINGS as defaults, DEFAULT_CNC_MACHINE_CONFIG as machine, IDENTITY_TRANSFORM as transform } from ${JSON.stringify(resolve('src/core/scene/index.ts'))};`;
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      lib: { entry: 'cnc-build-probe', name: 'cncProbe', formats: ['iife'] },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (output === undefined || !('output' in output)) throw new Error('Missing CNC build output');
  const chunk = output.output.find((item) => item.type === 'chunk');
  if (chunk?.type !== 'chunk') throw new Error('Missing CNC JS chunk');
  return runInNewContext(`${chunk.code}\ncncProbe;`, { TextEncoder, TextDecoder }) as CncProbe;
}

function cncScene(probe: CncProbe, choice: Partial<CncLayerSettings>): Scene {
  const layer = {
    ...probe.createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: { ...probe.defaults, tabsEnabled: false, depthMm: 2, depthPerPassMm: 1, ...choice },
  };
  const artwork: ImportedSvg = {
    kind: 'imported-svg',
    id: 'square',
    source: 'square.svg',
    bounds: { minX: 50, minY: 50, maxX: 80, maxY: 80 },
    transform: probe.transform,
    paths: [
      {
        color: layer.color,
        polylines: [
          {
            closed: true,
            points: [
              { x: 50, y: 50 },
              { x: 80, y: 50 },
              { x: 80, y: 80 },
              { x: 50, y: 80 },
            ],
          },
        ],
      },
    ],
  };
  return { layers: [layer], objects: [artwork] };
}
