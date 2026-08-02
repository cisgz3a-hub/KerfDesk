import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgramTime, type MotionLimits, type ProgramTimeModel } from '../../core/gcode-time';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../../core/gcode-view';
import { resolveViewer3dTheme } from '../viewer3d';
import { InspectorSidebar } from './InspectorSidebar';
import type * as InspectorReadoutsModule from './inspector-readouts';
import type * as LensesModule from './lenses';
import { playheadAtTime } from './playhead';

const spies = vi.hoisted(() => ({
  statsRows: vi.fn(),
  lensLegend: vi.fn(),
}));

vi.mock('./inspector-readouts', async (importOriginal) => {
  const actual = await importOriginal<typeof InspectorReadoutsModule>();
  spies.statsRows.mockImplementation(actual.statsRows);
  return { ...actual, statsRows: spies.statsRows };
});

vi.mock('./lenses', async (importOriginal) => {
  const actual = await importOriginal<typeof LensesModule>();
  spies.lensLegend.mockImplementation(actual.lensLegend);
  return { ...actual, lensLegend: spies.lensLegend };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LIMITS: MotionLimits = {
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  maxFeedMmPerMin: 6000,
};

const PROGRAM = [
  'G21 G90',
  'M3 S500',
  'G0 X10 Y0',
  'G1 X20 Y0 F600',
  'G1 X20 Y10',
  'G1 Z-2 F200',
  'G1 X10 Y10 F600',
  'M5',
].join('\n');

// InspectorView resolves the theme once per mount (a useMemo with no deps),
// so the harness holds one value too — a fresh object per render would be a
// prop change, not a re-render of the same props.
const THEME = resolveViewer3dTheme(null);

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function renderModel(): GcodeRenderModel {
  const result = buildGcodeRenderModel(PROGRAM);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

function sidebar(model: GcodeRenderModel, time: ProgramTimeModel, seconds: number): JSX.Element {
  return (
    <InspectorSidebar
      model={model}
      theme={THEME}
      playhead={playheadAtTime(model, time.segTimeEndSec, seconds)}
      time={time}
      findings={[]}
      lens="kind"
      onLensChange={() => undefined}
      arrowsVisible={false}
      onArrowsVisibleChange={() => undefined}
      travelVisible
      onTravelVisibleChange={() => undefined}
      onLocateLine={() => undefined}
    />
  );
}

function mount(element: JSX.Element): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(element));
}

beforeEach(() => {
  spies.statsRows.mockClear();
  spies.lensLegend.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('InspectorSidebar', () => {
  // Playback re-renders this column on every animation frame. Both helpers
  // scan every segment, so recomputing them per frame is O(segments) of work
  // per frame for numbers that cannot have changed.
  it('does not rescan the program when only the playhead moves', () => {
    const model = renderModel();
    const time = buildProgramTime(model, LIMITS);
    mount(sidebar(model, time, 0));
    expect(spies.statsRows).toHaveBeenCalledTimes(1);
    expect(spies.lensLegend).toHaveBeenCalledTimes(1);

    for (let frame = 1; frame <= 5; frame += 1) {
      act(() => root?.render(sidebar(model, time, (time.motionSeconds * frame) / 6)));
    }

    expect(spies.statsRows).toHaveBeenCalledTimes(1);
    expect(spies.lensLegend).toHaveBeenCalledTimes(1);
  });

  it('recomputes both when the program changes', () => {
    const model = renderModel();
    const time = buildProgramTime(model, LIMITS);
    mount(sidebar(model, time, 0));

    const nextModel = renderModel();
    const nextTime = buildProgramTime(nextModel, LIMITS);
    act(() => root?.render(sidebar(nextModel, nextTime, 0)));

    expect(spies.statsRows).toHaveBeenCalledTimes(2);
    expect(spies.lensLegend).toHaveBeenCalledTimes(2);
  });

  it('still shows the program stats and the move-kind legend', () => {
    const model = renderModel();
    const time = buildProgramTime(model, LIMITS);
    mount(sidebar(model, time, 0));

    const text = host?.textContent ?? '';
    expect(text).toContain('Segments');
    expect(text).toContain('Traversal');
    expect(text).toContain('Est. time');
  });
});
