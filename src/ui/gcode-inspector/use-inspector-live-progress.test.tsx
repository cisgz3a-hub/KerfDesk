import { Blob as NodeBlob } from 'node:buffer';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStreamer } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import {
  LIVE_PROGRAM,
  liveInspectorModel,
  liveInspectorRun,
  liveInspectorState,
} from './inspector-live-test-fixture';
import {
  useInspectorLiveProgress,
  type InspectorLiveProgress,
} from './use-inspector-live-progress';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let latest: InspectorLiveProgress | null;
const model = liveInspectorModel();
const source: GcodeInspectionSource = { kind: 'text', text: LIVE_PROGRAM };

function Probe(props: { readonly source: GcodeInspectionSource }): null {
  latest = useInspectorLiveProgress(model, props.source);
  return null;
}

async function render(nextSource = source): Promise<void> {
  await act(async () => root.render(<Probe source={nextSource} />));
}

beforeEach(() => {
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    ...liveInspectorState(),
  });
  latest = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useLaserStore.setState(initialLaserState());
});

describe('useInspectorLiveProgress', () => {
  it('keeps the trusted reported head distinct from the projected route reveal point', async () => {
    const run = useLaserStore.getState().liveCanvasRun;
    if (run == null) throw new Error('Expected run');
    useLaserStore.setState({
      liveCanvasRun: {
        ...run,
        reportedHead: { x: 5.2, y: 0.3, z: 0.1 },
      },
    });
    await render();
    expect(latest?.point).toEqual({ x: 5.2, y: 0.3, z: 0.1 });
    expect(latest?.playhead?.point).toEqual({ x: 5, y: 0, z: 0 });
    expect(latest?.progress).toBe(0.25);
  });

  it('follows controller-confirmed motion while ACKs can be far ahead', async () => {
    await render();
    expect(latest).toMatchObject({ matched: true, active: true, progress: 0.25, activeLine: 4 });
    act(() => {
      const streamer = useLaserStore.getState().streamer;
      if (streamer === null) throw new Error('Expected streamer');
      useLaserStore.setState({
        streamer: { ...streamer, completed: streamer.total, status: 'done' },
      });
    });
    expect(latest?.progress).toBe(0.25);
    expect(latest?.active).toBe(true);
    expect(latest?.point).toEqual({ x: 5, y: 0, z: 0 });
  });

  it('never follows an unrelated file, even with the same geometry or ACK count', async () => {
    await render({ kind: 'text', text: `${LIVE_PROGRAM}\n; another file` });
    expect(latest).toMatchObject({ matched: false, point: null, playhead: null, progress: null });
  });

  it('drops the binding immediately when source or the started queue changes', async () => {
    await render();
    expect(latest?.matched).toBe(true);
    await render({ kind: 'text', text: 'G1 X50' });
    expect(latest?.matched).toBe(false);
    await render();
    act(() => useLaserStore.setState({ streamer: createStreamer('G1 X50') }));
    expect(latest?.matched).toBe(false);
  });

  it('matches an identical file-backed source', async () => {
    const blob = new NodeBlob([LIVE_PROGRAM]) as unknown as Blob;
    await render({ kind: 'blob', blob });
    expect(latest?.matched).toBe(true);
    expect(latest?.point).toEqual({ x: 5, y: 0, z: 0 });
  });

  it('keeps confirmed trail frozen and withholds camera position for uncertainty', async () => {
    await render();
    act(() => {
      const run = useLaserStore.getState().liveCanvasRun;
      if (run == null) throw new Error('Expected run');
      useLaserStore.setState({
        liveCanvasRun: { ...run, route: { ...run.route, uncertain: true } },
      });
    });
    expect(latest).toMatchObject({ progress: 0.25, point: null });
    expect(latest?.reason).toContain('uncertain');
    expect(latest?.playhead?.point).toEqual({ x: 5, y: 0, z: 0 });
  });

  it('withholds the camera point after disconnect or a changed position reference', async () => {
    await render();
    act(() => useLaserStore.setState({ connection: { kind: 'disconnected' } }));
    expect(latest).toMatchObject({ matched: true, active: false, point: null, progress: 0.25 });
    act(() =>
      useLaserStore.setState({ connection: { kind: 'connected' }, trustedPositionEpoch: 1 }),
    );
    expect(latest?.point).toBeNull();
    expect(latest?.reason).toContain('reference changed');
  });

  it('retains terminal progress while stopping automatic live following', async () => {
    const run = liveInspectorRun();
    useLaserStore.setState({
      liveCanvasRun: {
        ...run,
        lifecycle: 'finished',
        route: { ...run.route, confirmedRouteMm: run.plan.manifest.totalRouteMm },
      },
      streamer: null,
    });
    await render();
    expect(latest).toMatchObject({
      matched: true,
      active: false,
      lifecycle: 'finished',
      progress: 1,
    });
    expect(latest?.playhead?.point).toEqual({ x: 10, y: 10, z: 0 });
    expect(latest?.point).toBeNull();
  });

  it('rejects a later same-bytes stream without a new started-plan association', async () => {
    await render();
    expect(latest?.matched).toBe(true);
    act(() =>
      useLaserStore.setState({
        streamer: { ...createStreamer(LIVE_PROGRAM), status: 'streaming' },
      }),
    );
    expect(latest).toMatchObject({ matched: false, point: null, progress: null });
    act(() => useLaserStore.setState({ streamer: null }));
    expect(latest).toMatchObject({ matched: false, point: null, progress: null });
  });
});
