import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import { LaserArcMovesRow } from './LaserArcMovesRow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function render(device: DeviceProfile, update = vi.fn()): Promise<typeof update> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<LaserArcMovesRow device={device} update={update} />));
  return update;
}

describe('LaserArcMovesRow (ADR-432)', () => {
  it('is hidden where the output never carries arcs', async () => {
    await render(DEFAULT_DEVICE_PROFILE);
    expect(host.querySelector('input')).toBeNull();
  });

  it('switches arcs off and back to the profile default', async () => {
    const grbl: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grbl-v1.1' };
    const update = await render(grbl);
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box?.checked).toBe(true);
    await act(async () => box?.click());
    expect(update).toHaveBeenLastCalledWith({ laserArcMoves: 'off' });

    await act(async () => root.unmount());
    host.remove();
    const again = await render({ ...grbl, laserArcMoves: 'off' });
    const off = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(off?.checked).toBe(false);
    await act(async () => off?.click());
    expect(again).toHaveBeenLastCalledWith({ laserArcMoves: undefined });
  });

  it('starts unticked on a brand profile and turns arcs on explicitly', async () => {
    const brand: DeviceProfile = {
      ...DEFAULT_DEVICE_PROFILE,
      vendor: 'xTool',
      controllerKind: 'grbl-v1.1',
    };
    const update = await render(brand);
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box?.checked).toBe(false);
    await act(async () => box?.click());
    expect(update).toHaveBeenLastCalledWith({ laserArcMoves: 'on' });
  });

  it('says G1 lines only while a rotary is enabled', async () => {
    await render({
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'grbl-v1.1',
      rotary: { enabled: true, type: 'roller', mmPerRotation: 100, objectDiameterMm: 40 },
    });
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
    expect(host.textContent).toContain('G1 lines only while the rotary is enabled');
    expect(host.querySelector('input')?.title).not.toContain('smoother');
  });
});
