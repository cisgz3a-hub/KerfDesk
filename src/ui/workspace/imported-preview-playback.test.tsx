import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_LAYER_SETTINGS,
  type Project,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import type { Toolpath } from '../../core/job';
import { open2dSimulatorFromText } from '../app/gcode-open-action';
import type { LiveJobEstimate } from '../laser/live-job-estimate';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { resetStore } from '../state/test-helpers';
import { PreviewStatsPanel } from './preview-overlays';
import { usePreviewEstimate } from './use-preview-estimate';
import { usePreviewPlayback } from './use-preview-playback';
import { usePreviewToolpath, type PreviewBuildScheduler } from './use-preview-toolpath';

let root: Root;
let host: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
let observed: { estimate: LiveJobEstimate; path: Toolpath | null };
const immediate: PreviewBuildScheduler = (work) => {
  work();
  return () => undefined;
};

function Harness({ schedule = immediate }: { readonly schedule?: PreviewBuildScheduler }) {
  const project = useStore((state) => state.project);
  const previewMode = useStore((state) => state.previewMode);
  const path = usePreviewToolpath(project, previewMode, schedule);
  const estimate = usePreviewEstimate();
  usePreviewPlayback(previewMode, path, estimate);
  observed = { estimate, path };
  return path === null ? null : <PreviewStatsPanel toolpath={path} estimate={estimate} />;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  frames = new Map();
  frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  resetStore();
  useUiStore.setState({ scrubberT: 0, previewPlaying: false, previewPlaybackSpeed: 'slow' });
  const base = createProject();
  const object = createRectangle({
    id: 'background',
    color: '#000000',
    spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
  });
  const project: Project = {
    ...base,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: addLayer(addObject(base.scene, object), {
      ...createLayer({ id: '#000000', color: '#000000' }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'engrave', depthMm: 1 },
    }),
  };
  useStore.setState({ project, previewMode: true });
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

describe('imported route timing in the mounted preview', () => {
  it('changes playback and readouts with imported feeds and restores the project estimate on exit', async () => {
    await act(async () => root.render(<Harness />));
    const projectEstimate = observed.estimate;
    const project = useStore.getState().project;
    await open('G21 G90\nG1 X100 F60');
    const slowEstimate = observed.estimate;
    await play();
    await frame(0);
    await frame(1000);
    const slowProgress = useUiStore.getState().scrubberT;
    await act(async () => useUiStore.getState().setPreviewPlaying(false));
    await open('G21 G90\nG1 X100 F6000');
    await act(async () => useUiStore.getState().setScrubberT(0));
    await play();
    await frame(0);
    await frame(1000);
    expect(useUiStore.getState().scrubberT).toBeGreaterThan(slowProgress * 10);
    if (slowEstimate.kind !== 'estimated' || observed.estimate.kind !== 'estimated')
      throw new Error('missing imported estimate');
    expect(slowEstimate.totalSeconds).toBeGreaterThan(observed.estimate.totalSeconds * 10);
    expect(host.textContent).toContain('Imported program timed for');
    expect(useStore.getState().project).toBe(project);
    await act(async () => useStore.getState().closeExternalGcodePreview());
    expect(observed.estimate).toBe(projectEstimate);
    expect(host.textContent).not.toContain('Imported program timed for');
  });

  it('keeps source timing when background artwork changes and never substitutes it for unavailable imports', async () => {
    await act(async () => root.render(<Harness />));
    await open('G21 G90\nG1 X100 F60');
    const importedEstimate = observed.estimate;
    await act(async () =>
      useStore.setState({
        project: { ...useStore.getState().project, scene: createProject().scene },
      }),
    );
    expect(observed.estimate).toBe(importedEstimate);
    await open('G21\nG81 X10 F60');
    expect(observed.path?.totalLength).toBeGreaterThan(0);
    expect(observed.estimate.kind).toBe('preparation-failed');
    expect(host.textContent).toContain('ETA unavailable');
    expect(host.textContent).toContain('Timing unavailable:');
  });

  it('holds the scrubber through source dwells and finishes only after the trailing dwell', async () => {
    await open('G21\nG4 P2\nG1 X10 F600\nG4 P3\nG1 X20 F600\nG4 P4');
    await act(async () => root.render(<Harness />));
    const timeline = useStore.getState().externalGcodePreview?.timing?.timeline;
    if (timeline === undefined || timeline === null) throw new Error('missing timeline');
    await play();
    await frame(0);
    await frame(1000);
    expect(useUiStore.getState().scrubberT).toBe(0);
    await frame(((timeline.segments[2]?.startSeconds ?? 0) + 1) * 1000);
    expect(useUiStore.getState().scrubberT).toBe(0.5);
    await frame((timeline.totalSeconds - 1) * 1000);
    expect(useUiStore.getState().scrubberT).toBe(1);
    expect(useUiStore.getState().previewPlaying).toBe(true);
    await frame((timeline.totalSeconds + 0.01) * 1000);
    expect(useUiStore.getState().previewPlaying).toBe(false);
    expect(
      host.querySelector('[title="Included in total time at its source line."]'),
    ).not.toBeNull();
  });

  it('withholds the previous route while a different imported owner is waiting to map', async () => {
    const pending: Array<() => void> = [];
    const schedule: PreviewBuildScheduler = (work) => {
      pending.push(work);
      return () => undefined;
    };
    await open('G21\nG1 X10 F60');
    await act(async () => root.render(<Harness schedule={schedule} />));
    await act(async () => pending.shift()?.());
    expect(observed.path?.totalLength).toBe(10);
    await open('G21\nG1 X100 F600');
    expect(observed.path).toBeNull();
    await act(async () => pending.shift()?.());
    expect(observed.path?.totalLength).toBe(100);
  });
});

async function open(text: string) {
  await act(async () =>
    open2dSimulatorFromText(
      'external.nc',
      text,
      useStore.getState().openExternalGcodePreview,
      vi.fn(),
    ),
  );
}

async function play() {
  await act(async () => useUiStore.getState().setPreviewPlaying(true));
}

async function frame(time: number) {
  const entry = frames.entries().next().value;
  if (entry === undefined) throw new Error('frame missing');
  frames.delete(entry[0]);
  await act(async () => entry[1](time));
}
