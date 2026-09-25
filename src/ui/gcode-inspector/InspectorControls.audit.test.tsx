import { beforeEach, expect, it, vi } from 'vitest';
import type * as Viewer3d from '../viewer3d';
import {
  clickControl,
  clickElement,
  control,
  mountControl,
} from '../image-editor/control-audit-test-support';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { InspectorView } from './InspectorView';
import { InspectorTimeline } from './InspectorTimeline';
import { InspectorHealthPanel } from './InspectorHealthPanel';
import { CanvasViewSwitch } from './CanvasViewSwitch';
import { CanvasGcodeView } from './CanvasGcodeView';
import { GcodeInspectorDialog } from './GcodeInspectorDialog';
import { analyzeGcodeModel } from './gcode-inspector-analysis';
import { indexGcodeTextLines } from './gcode-source-line-index';
import { LIVE_PROGRAM, liveInspectorModel } from './inspector-live-test-fixture';
import type { CurrentGcode } from './use-current-gcode';

const scene = vi.hoisted(() => ({
  setSegments: vi.fn(),
  fitToBounds: vi.fn(),
  setPlayhead: vi.fn(),
  recolor: vi.fn(),
  setDirectionArrows: vi.fn(),
  setLiveMachine: vi.fn(),
  setCameraTracking: vi.fn(),
  onCameraInteraction: vi.fn(),
  setTravelVisible: vi.fn(),
  setView: vi.fn(),
  captureImage: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  prepareToShow: vi.fn(async () => undefined),
}));
const current = vi.hoisted(() => ({
  state: { kind: 'idle' } as CurrentGcode,
  followingRun: false,
  refresh: vi.fn(),
}));
vi.mock('../viewer3d', async (original) => ({
  ...(await original<typeof Viewer3d>()),
  createViewer3dScene: vi.fn(async () => ({ kind: 'ok', handle: scene })),
}));
vi.mock('./use-current-gcode', () => ({ useCurrentGcode: () => ({ ...current, stale: false }) }));
vi.mock('./use-gcode-inspection', () => ({ useGcodeInspection: () => ({ kind: 'idle' }) }));
beforeEach(() => {
  vi.clearAllMocks();
  useLaserStore.setState(initialLaserState());
  current.state = { kind: 'idle' };
  current.followingRun = false;
});

it('ready Inspector routes every camera control, source toggle and travel/direction switch to the scene', async () => {
  const model = liveInspectorModel();
  const host = await mountControl(
    <InspectorView
      model={model}
      analysis={analyzeGcodeModel(model)}
      source={{ kind: 'text', text: LIVE_PROGRAM }}
      sourceIndex={indexGcodeTextLines(LIVE_PROGRAM, () => undefined)}
    />,
  );
  for (const [label, mode] of [
    ['Manual', 'manual'],
    ['Follow', 'follow'],
    ['Auto views', 'auto'],
  ]) {
    await clickControl(host, label!);
    expect(scene.setCameraTracking).toHaveBeenLastCalledWith(expect.objectContaining({ mode }));
  }
  for (const [label, preset] of [
    ['Iso', 'iso'],
    ['Top', 'top'],
    ['Front', 'front'],
    ['Right', 'right'],
    ['Fit', 'iso'],
  ]) {
    await clickControl(host, label!);
    expect(scene.setView).toHaveBeenLastCalledWith(preset);
  }
  await clickControl(host, 'PNG');
  expect(scene.captureImage).toHaveBeenCalledTimes(1);
  await clickControl(host, 'Hide source');
  expect(host.querySelector('[aria-label="Program source"]')).toBeNull();
  await clickControl(host, 'Show source');
  expect(host.querySelector('[aria-label="Program source"]')).not.toBeNull();
  await clickElement(
    host.querySelector<HTMLInputElement>('[title="Show or hide non-cutting travel moves"]'),
  );
  expect(scene.setTravelVisible).toHaveBeenLastCalledWith(false);
  await clickElement(
    host.querySelector<HTMLInputElement>(
      '[title="Show or hide the non-cutting moves between shapes"]',
    ),
  );
  expect(scene.setTravelVisible).toHaveBeenLastCalledWith(true);
  await clickElement(
    host.querySelector<HTMLInputElement>(
      '[title="Mark the cut path with arrows showing direction of travel"]',
    ),
  );
  expect(scene.setDirectionArrows).toHaveBeenLastCalledWith(expect.anything());
  await clickControl(host, 'Jump the playhead to line 3');
  expect(host.textContent).toContain('Line 3');
});

it('all preview transport buttons dispatch their exact action and empty programs disable stepping and play', async () => {
  const playback = {
    routeMm: 2,
    playing: false,
    speed: 1,
    setRouteMm: vi.fn(),
    setSpeed: vi.fn(),
    togglePlay: vi.fn(),
    stepBy: vi.fn(),
    restart: vi.fn(),
  };
  const host = await mountControl(<InspectorTimeline playback={playback} totalRouteMm={10} />);
  await clickControl(host, 'Restart');
  expect(playback.restart).toHaveBeenCalledTimes(1);
  await clickControl(host, 'Step back 0.25 seconds');
  expect(playback.stepBy).toHaveBeenLastCalledWith(-0.25);
  await clickControl(host, 'Step forward 0.25 seconds');
  expect(playback.stepBy).toHaveBeenLastCalledWith(0.25);
  await clickControl(host, 'Play');
  expect(playback.togglePlay).toHaveBeenCalledTimes(1);
  const playing = await mountControl(
    <InspectorTimeline playback={{ ...playback, playing: true }} totalRouteMm={10} />,
  );
  await clickControl(playing, 'Pause');
  expect(playback.togglePlay).toHaveBeenCalledTimes(2);
  const empty = await mountControl(<InspectorTimeline playback={playback} totalRouteMm={0} />);
  for (const label of ['Step back 0.25 seconds', 'Step forward 0.25 seconds', 'Play'])
    expect(control(empty, label).disabled).toBe(true);
});

it('health findings use zero-based source positions and omit navigation when no line exists', async () => {
  const locate = vi.fn();
  const finding = {
    id: 'audit',
    severity: 'warning' as const,
    title: 'Audit line',
    detail: 'Synthetic diagnostic',
    count: 1,
    line: 2,
  };
  const host = await mountControl(
    <InspectorHealthPanel
      findings={[finding, { ...finding, id: 'no-line', line: null }]}
      onLocate={locate}
    />,
  );
  expect(host.querySelectorAll('button')).toHaveLength(1);
  await clickControl(host, 'Go to line 3');
  expect(locate).toHaveBeenCalledWith(2);
});

it('canvas view buttons dispatch design and G-code choices without changing machine state', async () => {
  const change = vi.fn();
  const machine = useLaserStore.getState();
  const host = await mountControl(<CanvasViewSwitch showGcode={false} onChange={change} />);
  await clickControl(host, 'G-code 3D');
  await clickControl(host, 'Design');
  expect(change.mock.calls).toEqual([[true], [false]]);
  expect(useLaserStore.getState()).toBe(machine);
});

it('canvas refresh dispatches compilation, is unavailable during compile or active run, and releases a completed run', async () => {
  const idle = await mountControl(<CanvasGcodeView active />);
  await clickControl(idle, 'Refresh');
  expect(current.refresh).toHaveBeenCalledTimes(1);
  current.state = { kind: 'compiling' };
  const compiling = await mountControl(<CanvasGcodeView active />);
  expect(control(compiling, 'Compiling…').disabled).toBe(true);
  current.state = {
    kind: 'ready',
    text: LIVE_PROGRAM,
    programName: 'Audit',
    context: {},
    liveLifecycle: 'running',
  };
  current.followingRun = true;
  const running = await mountControl(<CanvasGcodeView active />);
  expect(control(running, 'Current design').disabled).toBe(true);
  current.state = { ...current.state, liveLifecycle: 'finished' };
  const done = await mountControl(<CanvasGcodeView active />);
  await clickControl(done, 'Current design');
  expect(current.refresh).toHaveBeenCalledTimes(2);
});

it('Inspector dialog Close and CNC-only simulator handoff invoke their respective callbacks', async () => {
  const close = vi.fn();
  const handoff = vi.fn();
  const props = {
    programName: 'audit.nc',
    source: { kind: 'text' as const, text: LIVE_PROGRAM },
    onClose: close,
    onOpen2dSimulator: handoff,
  };
  const host = await mountControl(<GcodeInspectorDialog {...props} machineKind="cnc" />);
  await clickControl(host, 'Open in 2D simulator');
  expect(handoff).toHaveBeenCalledTimes(1);
  await clickControl(host, 'Close');
  expect(close).toHaveBeenCalledTimes(1);
  const laser = await mountControl(<GcodeInspectorDialog {...props} machineKind="laser" />);
  expect(laser.textContent).not.toContain('Open in 2D simulator');
});
