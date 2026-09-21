import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import { useStore } from '../state';
import { buildCanvasMotionPlan, mapControllerPointToScene } from '../state/canvas-motion-plan';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { resetStore } from '../state/test-helpers';
import { StartFromLineControl } from './StartFromLineControl';
import { runStartFromLineFlow } from './start-job-flow';
import { streamResumeFromRawLine } from './start-job-resume-stream';
import { prepareRecoverySource, type PreparedRecoverySource } from './start-job-source';

vi.mock('./start-job-source', () => ({ prepareRecoverySource: vi.fn() }));
vi.mock('./start-job-flow', () => ({ runStartFromLineFlow: vi.fn() }));
vi.mock('./start-job-resume-stream', () => ({ streamResumeFromRawLine: vi.fn() }));
vi.mock('../state/job-aware-dialogs', () => ({ jobAwareAlert: vi.fn() }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  vi.mocked(prepareRecoverySource).mockReset();
  vi.mocked(streamResumeFromRawLine).mockReset();
  vi.mocked(runStartFromLineFlow).mockReset();
  vi.mocked(jobAwareAlert).mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root.render(<StartFromLineControl disabled={false} busy={false} machineKind="laser" />),
  );
  const disclosure = host.querySelector('details');
  if (disclosure !== null) disclosure.open = true;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useLaserStore.setState(initialLaserState());
  resetStore();
  vi.restoreAllMocks();
});

describe('manual laser restart preview', () => {
  it('guards duplicate preparation and Start, and streams the frozen source only after explicit Start', async () => {
    const source = preparedSource();
    const originalProject = structuredClone(source.project);
    const preparation = deferred<PreparedRecoverySource | null>();
    vi.mocked(prepareRecoverySource).mockReturnValue(preparation.promise);
    const choose = button('Choose restart point…');

    act(() => {
      choose.click();
      choose.click();
    });
    expect(prepareRecoverySource).toHaveBeenCalledTimes(1);
    expect(button('Choose restart point…').disabled).toBe(true);
    expect(button('Preparing recovery…').disabled).toBe(true);
    expect(streamResumeFromRawLine).not.toHaveBeenCalled();
    expect(runStartFromLineFlow).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      preparation.resolve(source);
      await preparation.promise;
    });
    const selectedLine = zoomAndSelectBurn(source);
    expect(streamResumeFromRawLine).not.toHaveBeenCalled();
    expect(source.project).toEqual(originalProject);

    // The open inspector owns its source even when the live stores advance.
    act(() => {
      useStore.setState({ project: createProject() });
      useLaserStore.setState({
        controllerSessionEpoch: source.controllerSnapshot.controllerSessionEpoch + 1,
      });
    });
    const starting = deferred<boolean>();
    vi.mocked(streamResumeFromRawLine).mockReturnValue(starting.promise);
    const start = button('Start selected remainder');
    act(() => {
      start.click();
      start.click();
    });

    expect(streamResumeFromRawLine).toHaveBeenCalledTimes(1);
    expect(streamResumeFromRawLine).toHaveBeenCalledWith(
      source.project,
      source.gcode,
      selectedLine,
      source.canvasPlan,
      source.laserModeStartSnapshot,
      undefined,
      source.controllerSnapshot,
    );
    const [project, gcode, , plan, , , controller] =
      vi.mocked(streamResumeFromRawLine).mock.calls[0]!;
    expect(project).toBe(source.project);
    expect(gcode).toBe(source.gcode);
    expect(plan).toBe(source.canvasPlan);
    expect(controller).toBe(source.controllerSnapshot);
    expect(button('Starting recovery…').disabled).toBe(true);
    expect(button('Cancel').disabled).toBe(true);
    expect(runStartFromLineFlow).not.toHaveBeenCalled();

    await act(async () => {
      starting.resolve(true);
      await starting.promise;
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(button('Choose restart point…').disabled).toBe(false);
  });

  it('cancels a selected preview without streaming or changing the document', async () => {
    const source = preparedSource();
    const originalProject = useStore.getState().project;
    vi.mocked(prepareRecoverySource).mockResolvedValue(source);
    await openPreview();
    zoomAndSelectBurn(source);

    act(() => button('Cancel').click());

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(streamResumeFromRawLine).not.toHaveBeenCalled();
    expect(runStartFromLineFlow).not.toHaveBeenCalled();
    expect(useStore.getState().project).toBe(originalProject);
    expect(button('Choose restart point…').disabled).toBe(false);
  });

  it.each(['refused', 'rejected'] as const)(
    'allows retry after preparation is %s',
    async (failure) => {
      const source = preparedSource();
      if (failure === 'refused') vi.mocked(prepareRecoverySource).mockResolvedValueOnce(null);
      else vi.mocked(prepareRecoverySource).mockRejectedValueOnce(new Error('Worker unavailable.'));
      vi.mocked(prepareRecoverySource).mockResolvedValueOnce(source);

      await openPreview();
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      expect(button('Choose restart point…').disabled).toBe(false);
      expect(streamResumeFromRawLine).not.toHaveBeenCalled();
      if (failure === 'rejected') {
        expect(jobAwareAlert).toHaveBeenCalledWith(expect.stringContaining('Worker unavailable.'));
      }

      await openPreview();
      expect(prepareRecoverySource).toHaveBeenCalledTimes(2);
      expect(host.querySelector('[role="dialog"]')).not.toBeNull();
      expect(streamResumeFromRawLine).not.toHaveBeenCalled();
    },
  );

  it.each(['refused', 'rejected'] as const)(
    'keeps the selected source retryable when Start is %s',
    async (failure) => {
      const source = preparedSource();
      vi.mocked(prepareRecoverySource).mockResolvedValue(source);
      if (failure === 'refused') vi.mocked(streamResumeFromRawLine).mockResolvedValueOnce(false);
      else
        vi.mocked(streamResumeFromRawLine).mockRejectedValueOnce(new Error('Connection changed.'));
      vi.mocked(streamResumeFromRawLine).mockResolvedValueOnce(true);
      await openPreview();
      const selectedLine = zoomAndSelectBurn(source);

      await act(async () => button('Start selected remainder').click());
      expect(host.querySelector('[role="dialog"]')).not.toBeNull();
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        failure === 'refused' ? 'Recovery was not started' : 'Connection changed.',
      );
      expect(button('Start selected remainder').disabled).toBe(false);
      expect(button('Cancel').disabled).toBe(false);

      await act(async () => button('Start selected remainder').click());
      expect(streamResumeFromRawLine).toHaveBeenCalledTimes(2);
      expect(vi.mocked(streamResumeFromRawLine).mock.calls[1]?.[2]).toBe(selectedLine);
      expect(vi.mocked(streamResumeFromRawLine).mock.calls[1]?.[6]).toBe(source.controllerSnapshot);
      expect(prepareRecoverySource).toHaveBeenCalledTimes(1);
      expect(host.querySelector('[role="dialog"]')).toBeNull();
    },
  );
});

async function openPreview(): Promise<void> {
  await act(async () => button('Choose restart point…').click());
}

function button(label: string): HTMLButtonElement {
  const candidate = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
  if (candidate === undefined) throw new Error(`Missing button: ${label}`);
  return candidate;
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function zoomAndSelectBurn(source: PreparedRecoverySource): number {
  const svg = host.querySelector<SVGSVGElement>('svg[aria-label^="Laser recovery canvas"]');
  if (svg === null) throw new Error('Missing recovery canvas.');
  const initialView = svg.getAttribute('viewBox');
  act(() =>
    host.querySelector<HTMLButtonElement>('[aria-label="Zoom in recovery canvas"]')?.click(),
  );
  expect(svg.getAttribute('viewBox')).not.toBe(initialView);
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 640,
    height: 320,
    right: 640,
    bottom: 320,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  const block = source.canvasPlan.manifest.blocks.find((item) => item.kind === 'process');
  const first = block?.points[0];
  const last = block?.points.at(-1);
  if (block === undefined || first === undefined || last === undefined)
    throw new Error('Missing burn movement.');
  const point = mapControllerPointToScene(
    { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2, z: 0 },
    source.canvasPlan,
  );
  const event = canvasPointer(svg, point);
  act(() => {
    svg.dispatchEvent(new MouseEvent('pointerdown', event));
    svg.dispatchEvent(new MouseEvent('pointerup', event));
  });
  const rawLine = block.rawLineIndex + 1;
  expect(
    host.querySelector('[data-testid="selected-recovery-movement"]')?.getAttribute('data-raw-line'),
  ).toBe(String(rawLine));
  expect(host.querySelector<HTMLInputElement>('[role="dialog"] input[type="number"]')?.value).toBe(
    String(rawLine),
  );
  return rawLine;
}

function canvasPointer(
  svg: SVGSVGElement,
  point: { readonly x: number; readonly y: number },
): MouseEventInit {
  const [x = 0, y = 0, width = 1, height = 1] = (svg.getAttribute('viewBox') ?? '')
    .split(' ')
    .map(Number);
  return {
    bubbles: true,
    button: 0,
    clientX: ((point.x - x) / width) * 640,
    clientY: ((point.y - y) / height) * 320,
  };
}

function preparedSource(): PreparedRecoverySource {
  const project: Project = {
    ...createProject(),
    scene: {
      objects: [
        {
          kind: 'imported-svg',
          id: 'manual-restart-line',
          source: 'manual-restart.svg',
          bounds: { minX: 1, minY: 1, maxX: 9, maxY: 9 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 1, y: 1 },
                    { x: 9, y: 9 },
                  ],
                },
              ],
            },
          ],
        },
      ],
      layers: [createLayer({ id: 'red', color: '#ff0000' })],
    },
  };
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('Invalid manual restart fixture.');
  const { gcode } = emitPreparedGcode(prepared);
  const controllerSnapshot = useLaserStore.getState();
  return {
    project,
    gcode,
    prepared,
    canvasPlan: buildCanvasMotionPlan({
      gcode,
      prepared,
      retentionKey: 'frozen-manual-restart',
      machine: { statusReport: null, alarmCode: null, hasActiveStreamer: false },
    }),
    controllerSnapshot,
    laserModeStartSnapshot: captureLaserModeStartSnapshot(controllerSnapshot),
    laserResumeChain: [],
    warnings: [],
  };
}
