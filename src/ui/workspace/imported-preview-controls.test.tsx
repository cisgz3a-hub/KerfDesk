import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseTimedGcodePreview } from '../import/gcode-preview-timing';
import type { GcodeInspectionContext } from '../gcode-inspector/gcode-inspection-source';
import { PreviewRouteControls } from './preview-overlays';
import { usePreviewPlayback } from './use-preview-playback';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { resetStore } from '../state/test-helpers';
const CONTEXT: GcodeInspectionContext = {
  machineKind: 'cnc',
  timing: {
    limits: { accelMmPerSec2: 500, junctionDeviationMm: 0.01, maxFeedMmPerMin: 6000 },
    deviceName: 'Fixture',
  },
};
function parsed(source: string) {
  const result = parseTimedGcodePreview(source, CONTEXT);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result;
}
let host: HTMLDivElement;
let root: Root;
let frames: Map<number, FrameRequestCallback>;
let frameId = 0;

function Harness() {
  const external = useStore((state) => state.externalGcodePreview);
  if (external?.timing == null) throw new Error('missing imported fixture');
  usePreviewPlayback(true, external.toolpath, external.timing.estimate);
  return <PreviewRouteControls />;
}

describe('real controls with imported dwell playback', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    frames = new Map();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    resetStore();
    useUiStore.setState({ scrubberT: 0, previewPlaying: false, previewPlaybackSpeed: 'slow' });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    resetStore();
    vi.unstubAllGlobals();
  });

  it('Play after pausing a trailing dwell does not restart the route', async () => {
    const result = await mount('G21 G90\nG1 X10 F600\nG4 P3');
    const total = result.timing?.timeline?.totalSeconds;
    if (total === undefined) throw new Error('missing time');
    await click('Play route preview');
    await frame(0);
    await frame((total - 1.5) * 1000);
    expect(useUiStore.getState().scrubberT).toBe(1);
    expect(useUiStore.getState().previewPlaying).toBe(true);
    await click('Pause route preview');
    await click('Play route preview');
    expect(useUiStore.getState().scrubberT).toBe(1);
    await frame(10000);
    await frame(11000);
    expect(useUiStore.getState().previewPlaying).toBe(true);
    expect(useUiStore.getState().scrubberT).toBe(1);
    await frame(11600);
    expect(useUiStore.getState().previewPlaying).toBe(false);
    await click('Play route preview');
    expect(useUiStore.getState().previewPlaying).toBe(true);
    expect(useUiStore.getState().scrubberT).toBe(0);
  });

  it.each([false, true])(
    'Restart during leading dwell resets elapsed time while paused=%s',
    async (paused) => {
      await mount('G21 G90\nG4 P4\nG1 X10 F600');
      await click('Play route preview');
      await frame(0);
      await frame(2000);
      expect(useUiStore.getState().scrubberT).toBe(0);
      if (paused) await click('Pause route preview');
      await click('Restart route preview');
      await click('Play route preview');
      await frame(10000);
      await frame(13000);
      expect(useUiStore.getState().scrubberT).toBe(0);
      await frame(14500);
      expect(useUiStore.getState().scrubberT).toBeGreaterThan(0);
    },
  );

  it('plays a newly opened route from the start when the existing scrubber is at the end', async () => {
    useUiStore.setState({ scrubberT: 1 });
    await mount('G21 G90\nG4 P2\nG1 X10 F600\nG4 P3');
    await click('Play route preview');
    expect(useUiStore.getState().scrubberT).toBe(0);
    await frame(0);
    await frame(1000);
    expect(useUiStore.getState().scrubberT).toBe(0);
    await frame(2500);
    expect(useUiStore.getState().scrubberT).toBeGreaterThan(0);
  });

  it('replays geometry-only imports after reaching their endpoint', async () => {
    useUiStore.setState({ scrubberT: 1 });
    await mount('G21 G90\nG1 X10');
    expect(useStore.getState().externalGcodePreview?.timing?.timeline).toBeNull();
    await click('Play route preview');
    expect(useUiStore.getState().scrubberT).toBe(0);
    await frame(0);
    await frame(3000);
    expect(useUiStore.getState().scrubberT).toBeCloseTo(0.1, 8);
  });
});

async function mount(source: string) {
  const result = parsed(source);
  await act(async () => {
    useStore.getState().openExternalGcodePreview('audit.nc', result.toolpath, result.timing);
    root.render(<Harness />);
  });
  return result;
}

async function click(label: string) {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (button === null) throw new Error(`Missing ${label}`);
  await act(async () => button.click());
}

async function frame(time: number) {
  const entry = frames.entries().next().value;
  if (entry === undefined) throw new Error('missing animation frame');
  frames.delete(entry[0]);
  await act(async () => entry[1](time));
}
