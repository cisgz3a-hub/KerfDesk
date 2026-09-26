// ADR-322 Amendment 2: Machine Setup offers a corrected preset value in one
// click, where Amendment 1 only named it in Job Review.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SCULPFUN_S30_PROFILE,
  XTOOL_D1_PRO_PROFILES,
} from '../../core/devices/brand-laser-profiles';
import type { DeviceProfile } from '../../core/devices';
import { PresetCorrectionOffer } from './PresetCorrectionOffer';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(device: DeviceProfile, update: (patch: Partial<DeviceProfile>) => void): void {
  act(() => root.render(<PresetCorrectionOffer device={device} update={update} />));
}

function button(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  );
}

describe('PresetCorrectionOffer', () => {
  it('applies the corrected origin to a stale xTool D1 Pro copy', () => {
    const [xtool] = XTOOL_D1_PRO_PROFILES;
    if (xtool === undefined) throw new Error('missing preset');
    const update = vi.fn();
    render({ ...xtool, origin: 'front-left' }, update);

    expect(host.textContent).toContain('still has origin front-left');
    act(() => button('Use the corrected rear-left')?.click());

    expect(update).toHaveBeenCalledExactlyOnceWith({ origin: 'rear-left' });
  });

  it('applies the corrected bed to a stale Sculpfun S30 copy', () => {
    const update = vi.fn();
    render({ ...SCULPFUN_S30_PROFILE, bedWidth: 410, bedHeight: 400 }, update);

    act(() => button('Use the corrected 380 x 385 mm')?.click());

    expect(update).toHaveBeenCalledExactlyOnceWith({ bedWidth: 380, bedHeight: 385 });
  });

  it('shows nothing for a current preset or the operator’s own value', () => {
    const [xtool] = XTOOL_D1_PRO_PROFILES;
    if (xtool === undefined) throw new Error('missing preset');
    render(xtool, vi.fn());
    expect(host.textContent).toBe('');
    render({ ...xtool, origin: 'rear-right' }, vi.fn());
    expect(host.textContent).toBe('');
  });
});
