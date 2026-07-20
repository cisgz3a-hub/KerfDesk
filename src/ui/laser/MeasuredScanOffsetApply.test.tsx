import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { resetStore } from '../state/test-helpers';
import { MeasuredScanOffsetApply } from './MeasuredScanOffsetApply';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareConfirm: vi.fn(() => true),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderMeasuredApply(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<MeasuredScanOffsetApply />);
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
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
});

describe('MeasuredScanOffsetApply', () => {
  it('saves measured scan offsets to the active device profile', async () => {
    const { host, unmount } = await renderMeasuredApply();
    try {
      await changeInput(host, 'Measured offset 1', '-0.05');
      await changeInput(host, 'Measured offset 3', '0.18');
      await changeInput(host, 'Measured speed 3', '3000');

      await act(async () => {
        button(host, 'Apply measured offsets').click();
      });

      expect(useStore.getState().project.device.scanningOffsets).toEqual([
        { speedMmPerMin: 1000, offsetMm: -0.05 },
        { speedMmPerMin: 3000, offsetMm: 0.18 },
      ]);
      expect(useStore.getState().project.device.scanOffsetCalibrationStatus).toBe('pending');
      expect(useStore.getState().dirty).toBe(true);
      expect(host.textContent).toContain('Verification pending');
    } finally {
      await unmount();
    }
  });

  it('restores persisted pending state after the calibration panel remounts', async () => {
    const first = await renderMeasuredApply();
    await changeInput(first.host, 'Measured offset 1', '0.05');
    await act(async () => button(first.host, 'Apply measured offsets').click());
    await first.unmount();

    const second = await renderMeasuredApply();
    try {
      expect(second.host.textContent).toContain('Verification pending');
      expect(button(second.host, 'Mark verification burn passed')).toBeTruthy();
    } finally {
      await second.unmount();
    }
  });

  it('requires explicit confirmation before marking a real verification burn passed', async () => {
    useStore.getState().updateDeviceProfile({
      scanningOffsets: [{ speedMmPerMin: 2000, offsetMm: 0.1 }],
      scanOffsetCalibrationStatus: 'pending',
    });
    const { host, unmount } = await renderMeasuredApply();
    try {
      await act(async () => button(host, 'Mark verification burn passed').click());

      expect(jobAwareConfirm).toHaveBeenCalledWith(expect.stringContaining('Only continue after'));
      expect(useStore.getState().project.device.scanOffsetCalibrationStatus).toBe('verified');
      expect(host.textContent).toContain('Verification burn passed');
    } finally {
      await unmount();
    }
  });

  it('starts from existing calibrated offsets when reopening the panel', async () => {
    useStore.getState().updateDeviceProfile({
      scanningOffsets: [
        { speedMmPerMin: 2500, offsetMm: 0.12 },
        { speedMmPerMin: 5000, offsetMm: 0.2 },
      ],
    });

    const { host, unmount } = await renderMeasuredApply();
    try {
      expect(input(host, 'Measured speed 1').value).toBe('2500');
      expect(input(host, 'Measured offset 1').value).toBe('0.12');
      expect(input(host, 'Measured speed 2').value).toBe('5000');
      expect(input(host, 'Measured offset 2').value).toBe('0.2');
    } finally {
      await unmount();
    }
  });

  it('explains the reverse-only full signed measurement and previews the candidate table', async () => {
    const { host, unmount } = await renderMeasuredApply();
    try {
      expect(host.textContent).toContain('Do not divide the measurement in half');
      expect(host.textContent).toContain('shifts reverse rows only');
      await changeInput(host, 'Measured offset 1', '0.07');
      const preview = host.querySelector('table[aria-label="Candidate scan-offset table"]');
      expect(preview?.textContent).toContain('+0.07 mm');
      expect(preview?.textContent).toContain('1000 mm/min');
    } finally {
      await unmount();
    }
  });

  it('blocks duplicate speeds and measurements above the profile max feed', async () => {
    useStore.getState().updateDeviceProfile({ maxFeed: 2500 });
    const { host, unmount } = await renderMeasuredApply();
    try {
      await changeInput(host, 'Measured offset 1', '0.05');
      await changeInput(host, 'Measured speed 2', '1000');
      await changeInput(host, 'Measured offset 2', '0.08');
      await act(async () => button(host, 'Add measurement').click());
      await changeInput(host, 'Measured speed 3', '3000');
      await changeInput(host, 'Measured offset 3', '0.1');

      expect(host.textContent).toContain('speed 1000 mm/min is duplicated');
      expect(host.textContent).toContain('exceeds the profile limit of 2500 mm/min');
      expect(button(host, 'Apply measured offsets').disabled).toBe(true);
    } finally {
      await unmount();
    }
  });

  it('rejects an offset outside the physical profile-relative limit', async () => {
    const { host, unmount } = await renderMeasuredApply();
    try {
      await changeInput(host, 'Measured offset 1', '1e308');

      expect(host.textContent).toContain('offset must be between -4 and 4 mm');
      expect(button(host, 'Apply measured offsets').disabled).toBe(true);
    } finally {
      await unmount();
    }
  });
});

async function changeInput(host: HTMLElement, label: string, value: string): Promise<void> {
  const field = input(host, label);
  await act(async () => {
    field.value = value;
    Simulate.change(field);
  });
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}

function input(host: HTMLElement, label: string): HTMLInputElement {
  const match = host.querySelector(`input[aria-label="${label}"]`);
  if (!(match instanceof HTMLInputElement)) throw new Error(`Input not rendered: ${label}`);
  return match;
}
