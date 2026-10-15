// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { browserFreeBuild, replaceProEntryBodies } from '../../scripts/browser-free-build';

const hosts = [
  ['src/ui/workspace/RegistrationJigPanel.tsx', 'RegistrationJigPanel'],
  ['src/ui/laser/board-capture/BoardCapturePanel.tsx', 'BoardCapturePanel'],
] as const;

describe('browser Free placement tool boundary', () => {
  it.each(hosts)('replaces the %s host and all implementation imports', (path, name) => {
    const transformed = replaceProEntryBodies(readFileSync(resolve(path), 'utf8'), path);
    expect(transformed).toBe(`export function ${name}() { return null; }`);
    expect(transformed).not.toContain('import');
  });

  it('bundles inert panel hosts while existing placement geometry still compiles', async () => {
    const { api, modules } = await placementBundle();
    // No React provider, store state or edition mock can reactivate these hosts.
    expect(api.RegistrationJigPanel()).toBeNull();
    expect(api.BoardCapturePanel()).toBeNull();
    expect(modules.some((path) => path.endsWith('/RegistrationJigOutlineControls.tsx'))).toBe(
      false,
    );
    expect(modules.some((path) => path.endsWith('/use-board-capture.ts'))).toBe(false);
    expect(api.existingJigOutput()).toBeGreaterThan(0);
    expect(api.savedBoardCenter()).toEqual({ x: 40, y: 30 });
  }, 30_000);
});

type PlacementProbe = {
  RegistrationJigPanel: () => null;
  BoardCapturePanel: () => null;
  existingJigOutput: () => number;
  savedBoardCenter: () => { x: number; y: number };
};

async function placementBundle(): Promise<{ api: PlacementProbe; modules: string[] }> {
  const modulePath = (path: string): string => JSON.stringify(resolve(path));
  const result = await build({
    configFile: false,
    root: resolve('.'),
    mode: 'production',
    logLevel: 'silent',
    plugins: [
      browserFreeBuild(),
      {
        name: 'placement-build-probe',
        resolveId(id) {
          return id.endsWith('placement-build-probe') ? '\0placement-build-probe' : undefined;
        },
        load(id) {
          if (id !== '\0placement-build-probe') return undefined;
          return `
            export { RegistrationJigPanel } from ${modulePath(hosts[0][0])};
            export { BoardCapturePanel } from ${modulePath(hosts[1][0])};
            import { createRegistrationBox } from ${modulePath('src/core/shapes/registration-box.ts')};
            import { createRegistrationLayer } from ${modulePath('src/core/scene/registration-layer.ts')};
            import { compileJob } from ${modulePath('src/core/job/compile-job.ts')};
            import { DEFAULT_DEVICE_PROFILE } from ${modulePath('src/core/devices/index.ts')};
            import { boardMachinePoints } from ${modulePath('src/core/scene/board-capture.ts')};
            export function existingJigOutput() {
              const scene = {
                layers: [createRegistrationLayer()],
                objects: [createRegistrationBox({ widthMm: 60, heightMm: 40 })],
              };
              return compileJob(scene, DEFAULT_DEVICE_PROFILE).groups.length;
            }
            export function savedBoardCenter() {
              return boardMachinePoints([
                {x:10,y:10}, {x:70,y:10}, {x:70,y:50}, {x:10,y:50}
              ]).center;
            }
          `;
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      lib: { entry: 'placement-build-probe', name: 'placementProbe', formats: ['iife'] },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (output === undefined || !('output' in output)) throw new Error('Missing placement build');
  const chunk = output.output.find((item) => item.type === 'chunk');
  if (chunk?.type !== 'chunk') throw new Error('Missing placement JS');
  return {
    api: runInNewContext(`${chunk.code}\nplacementProbe;`, {
      TextEncoder,
      TextDecoder,
    }) as PlacementProbe,
    modules: Object.keys(chunk.modules).map((path) => path.replaceAll('\\', '/')),
  };
}
