import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildGcodeRenderModel } from '../../core/gcode-view';
import type { Viewer3dSceneHandle } from '../viewer3d';
import { moveDoseJPerMm2 } from './burn-grid';
import { startBurnWorker } from './burn-worker-client';
import { useLaserBurn, type LaserBurn } from './use-laser-burn';

vi.mock('./burn-worker-client', () => ({ startBurnWorker: vi.fn() }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let latest: LaserBurn | null = null;

function current(): LaserBurn {
  if (latest === null) throw new Error('No hook result');
  return latest;
}

function Probe(props: Parameters<typeof useLaserBurn>[0]): null {
  latest = useLaserBurn(props);
  return null;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  latest = null;
  vi.mocked(startBurnWorker).mockReset();
  vi.mocked(startBurnWorker).mockReturnValue({ burn: vi.fn(), dispose: vi.fn() });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('keeps the rotary surface dose in the readout and worker when Wrap is toggled', () => {
  const parsed = buildGcodeRenderModel('G21 G90\nG0 X0 Y0\nM3 S1000\nG1 Y10 F3000\nM5', {
    machineKind: 'laser',
  });
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  const args: Parameters<typeof useLaserBurn>[0] = {
    handleRef: {
      current: { setBurn: vi.fn(), setBurnMaterial: vi.fn() } as unknown as Viewer3dSceneHandle,
    },
    state: 'ready',
    model: parsed.model,
    machineKind: 'laser',
    laser: {
      maxPowerS: 1000,
      spotMm: 0.1,
      opticalPowerW: 10,
      rotary: { diameterMm: 60, wrapYMm: 40 },
    },
    target: { index: parsed.model.segmentCount, fraction: 0 },
  };
  act(() => root.render(<Probe {...args} />));
  act(() => current().onShownChange(true));
  expect(current().energy.range?.max).toBeCloseTo(0.42441318157838753, 10);
  const wrapped = vi.mocked(startBurnWorker).mock.lastCall?.[0];
  if (wrapped === undefined) throw new Error('No wrapped worker');
  expect(wrapped.laser.wrapYMm).toBe(40);
  expect(moveDoseJPerMm2(wrapped.moves, wrapped.laser, 0, 10)).toBeCloseTo(0.42441318157838753, 10);
  act(() => current().wrap?.onShownChange(false));
  expect(current().energy.range?.max).toBeCloseTo(0.42441318157838753, 10);
  const flat = vi.mocked(startBurnWorker).mock.lastCall?.[0];
  if (flat === undefined) throw new Error('No flat worker');
  expect(flat.laser.wrapYMm).toBeUndefined();
  expect(moveDoseJPerMm2(flat.moves, flat.laser, 0, 10)).toBeCloseTo(0.42441318157838753, 10);
});
