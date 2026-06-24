import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useLaserStore } from '../state/laser-store';
import {
  describePatch,
  describeReviewItems,
  DetectedSettingsBanner,
} from './DetectedSettingsBanner';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderDetectedSettingsBanner(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(createElement(DetectedSettingsBanner));
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  resetStore();
  useLaserStore.setState({
    detectedSettings: null,
    controllerSettings: null,
    grblSettingsRows: [],
  });
});

describe('describePatch', () => {
  it('surfaces GRBL $31 and $32 alongside $30 detected settings', () => {
    const rows = describePatch(
      { maxPowerS: 255, minPowerS: 10, laserModeEnabled: false },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(rows.map((r) => r.label)).toEqual([
      'Max power (S)',
      'Min power (S)',
      'Laser mode ($32)',
    ]);
    expect(rows[1]).toMatchObject({
      oldText: '0',
      newText: '10',
      changed: true,
    });
    expect(rows[2]).toMatchObject({
      oldText: 'Enabled',
      newText: 'Disabled',
      changed: true,
    });
  });

  it('surfaces detected Z max travel from GRBL $132', () => {
    const rows = describePatch({ zTravelMm: 75 }, DEFAULT_DEVICE_PROFILE);

    expect(rows).toEqual([
      expect.objectContaining({
        label: 'Z travel',
        oldText: 'Not set',
        newText: '75.000 mm',
        changed: true,
      }),
    ]);
  });

  it('omits controller values that already match the active profile', () => {
    const rows = describePatch(
      { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(rows).toEqual([]);
  });
});

describe('describeReviewItems', () => {
  it('offers a guarded powered Z action without confirming Z travel automatically', () => {
    const review = describeReviewItems(
      { zTravelMm: 75 },
      DEFAULT_DEVICE_PROFILE,
      { zTravelMm: 75, zMaxFeed: 300 },
      [],
    );

    expect(review.needsReview).toEqual([
      expect.objectContaining({
        label: 'Powered Z jog',
        detail:
          'Controller reports Z travel and Z max rate. Confirm the machine has a motorized Z/focus axis before enabling Z jog buttons.',
        action: expect.objectContaining({
          helpId: 'control:laser.detected-settings.powered-z',
          label: 'Mark profile as powered Z',
          title: 'Adds powered Z capability but keeps Z jog blocked until travel is confirmed.',
          patch: expect.objectContaining({
            capabilities: expect.arrayContaining(['z-axis']),
            zTravelMm: 75,
            zTravelConfirmed: false,
          }),
        }),
      }),
    ]);
    expect(review.ignored).toEqual([]);
  });

  it('surfaces homing and limit settings as review-only controller behavior', () => {
    const review = describeReviewItems(
      {},
      DEFAULT_DEVICE_PROFILE,
      {
        softLimitsEnabled: true,
        hardLimitsEnabled: false,
        homingEnabled: true,
        homingDirectionMask: 3,
      },
      [],
    );

    expect(review.needsReview.map((item) => item.label)).toEqual([
      'Soft limits ($20)',
      'Hard limits ($21)',
      'Homing cycle ($22)',
      'Homing direction mask ($23)',
    ]);
  });

  it('lists unknown GRBL settings as ignored so auto-detect stays explainable', () => {
    const review = describeReviewItems({}, DEFAULT_DEVICE_PROFILE, {}, [
      {
        id: 999,
        code: '$999',
        rawValue: '42',
        numericValue: 42,
        name: 'Unknown GRBL setting',
        unit: null,
        description: 'Unknown',
        category: 'unknown',
        known: false,
        writeRisk: 'unknown',
      },
    ]);

    expect(review.ignored).toEqual([
      expect.objectContaining({
        label: '$999',
        detail: 'Unknown GRBL setting was read but not applied to the LaserForge profile.',
      }),
    ]);
  });
});

describe('DetectedSettingsBanner', () => {
  it('exposes explicit help metadata on the detected-settings review controls', async () => {
    useLaserStore.setState({
      detectedSettings: { maxPowerS: 255, zTravelMm: 75 },
      controllerSettings: { maxPowerS: 255, zTravelMm: 75, zMaxFeed: 300 },
      grblSettingsRows: [],
    });

    const { host, unmount } = await renderDetectedSettingsBanner();
    try {
      const region = host.querySelector('[aria-label="Detected machine settings"]');
      if (!(region instanceof HTMLElement)) {
        throw new Error('Detected settings region missing');
      }

      expect(region.dataset.helpId).toBe('control:laser.detected-settings.review');
      expect(region.title.length).toBeGreaterThan(30);

      expect(button(host, 'Dismiss').dataset.helpId).toBe(
        'control:laser.detected-settings.dismiss',
      );
      expect(button(host, 'Apply safe settings').dataset.helpId).toBe(
        'control:laser.detected-settings.apply-safe',
      );
      expect(button(host, 'Mark profile as powered Z').dataset.helpId).toBe(
        'control:laser.detected-settings.powered-z',
      );
    } finally {
      await unmount();
    }
  });

  it('applies the guarded powered Z action to the active profile only after click', async () => {
    useLaserStore.setState({
      detectedSettings: { zTravelMm: 75 },
      controllerSettings: { zTravelMm: 75, zMaxFeed: 300 },
      grblSettingsRows: [],
    });

    const { host, unmount } = await renderDetectedSettingsBanner();
    try {
      expect(useStore.getState().project.device.capabilities).not.toContain('z-axis');

      const button = [...host.querySelectorAll('button')].find((candidate) =>
        candidate.textContent?.includes('Mark profile as powered Z'),
      );
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Powered Z action button missing');
      }

      await act(async () => {
        button.click();
      });

      expect(useStore.getState().project.device).toMatchObject({
        zTravelMm: 75,
        zTravelConfirmed: false,
      });
      expect(useStore.getState().project.device.capabilities).toContain('z-axis');
    } finally {
      await unmount();
    }
  });
});

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}
