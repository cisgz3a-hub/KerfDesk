// The Camera panel's Watch the job section (ADR-490): its choices are
// remembered on this computer, and the burn check's verdict reads in plain
// words with the tinted picture a click away.

import { beforeEach, describe, expect, it } from 'vitest';
import type { BurnReport } from '../../../core/camera/job-watch/burn-comparison';
import type { PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { clickElement, mountControl } from '../../image-editor/control-audit-test-support';
import { useCameraStore } from '../../state/camera-store';
import { burnCheckSentences } from './BurnCheckResult';
import { JobWatchSection } from './JobWatchSection';
import { DEFAULT_JOB_WATCH_SETTINGS, loadJobWatchSettings } from './job-watch-settings';
import { useJobWatchStore } from './job-watch-store';

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
};

function mountSection(): Promise<HTMLElement> {
  return mountControl(
    <PlatformProvider adapter={platform}>
      <JobWatchSection />
    </PlatformProvider>,
  );
}

function checkbox(host: HTMLElement, label: string): HTMLInputElement {
  const found = [...host.querySelectorAll('label')].find((l) => l.textContent?.includes(label));
  const input = found?.querySelector('input');
  if (input === null || input === undefined) throw new Error(`no checkbox ${label}`);
  return input;
}

function button(host: HTMLElement, label: string): HTMLButtonElement | null {
  return [...host.querySelectorAll('button')].find((b) => b.textContent === label) ?? null;
}

const report: BurnReport = {
  pathPixels: 1000,
  seenPathPixels: 900,
  burnedPathPixels: 873,
  coverage: 0.97,
  hiddenShare: 0.1,
  strayMarks: 1,
  strayAreaMm2: 3.25,
};

beforeEach(() => {
  localStorage.clear();
  useJobWatchStore.setState({
    settings: DEFAULT_JOB_WATCH_SETTINGS,
    timelapse: null,
    burnCheck: { kind: 'idle' },
  });
  useCameraStore.setState({ bedPicture: null, overlayVisible: false });
});

describe('JobWatchSection', () => {
  it('remembers the choices on this computer', async () => {
    const host = await mountSection();
    await clickElement(checkbox(host, 'Record a timelapse'));
    await clickElement(checkbox(host, 'Check the burn'));
    expect(loadJobWatchSettings()).toEqual({
      timelapse: true,
      intervalSeconds: 5,
      burnCheck: true,
    });
    expect(host.textContent).toContain('nothing moves the machine');
  });

  it('shows the verdict and puts the tinted picture on the canvas', async () => {
    const picture = {
      image: { data: new Uint8ClampedArray(4), width: 1, height: 1 },
      region: { x: 10, y: 10, width: 1, height: 1 },
      surfaceHeightMm: 0,
    };
    useJobWatchStore.setState({ burnCheck: { kind: 'done', report, picture } });
    const host = await mountSection();
    expect(host.textContent).toContain('The camera sees a change along 97% of the path');
    await clickElement(button(host, 'Show on canvas'));
    expect(useCameraStore.getState().bedPicture).toBe(picture);
    expect(useCameraStore.getState().overlayVisible).toBe(true);
    await clickElement(button(host, 'Hide from canvas'));
    expect(useCameraStore.getState().bedPicture).toBeNull();
  });
});

describe('burnCheckSentences', () => {
  it('says what burned, what strayed, and what the camera could not judge', () => {
    expect(burnCheckSentences(report)).toEqual([
      'The camera sees a change along 97% of the path; where it saw none is red.',
      '1 mark outside the path (3.3 mm²), in amber.',
      '10% of the path was hidden from the camera (the head, the gantry, or something moving), so it was not judged.',
    ]);
  });

  it('calls a clean job clean', () => {
    expect(
      burnCheckSentences({
        ...report,
        coverage: 1,
        hiddenShare: 0,
        strayMarks: 0,
        strayAreaMm2: 0,
      }),
    ).toEqual(['The camera sees a change along all of the path.', 'No marks outside the path.']);
  });
});
