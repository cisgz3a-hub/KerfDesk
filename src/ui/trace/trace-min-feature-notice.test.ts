import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type LayerMode,
  type Polyline,
  type Project,
  type TracedImage,
} from '../../core/scene';
import { scheduleTraceMinFeatureNotice, traceMinFeatureNotice } from './trace-min-feature-notice';

// A device without a laser head profile, so the kerf comes from the operation.
const { laserSubProfile: _head, ...HEADLESS_DEVICE } = DEFAULT_DEVICE_PROFILE;

function line(y: number): Polyline {
  return {
    closed: false,
    points: [
      { x: 10, y },
      { x: 40, y },
    ],
  };
}

// A centerline trace whose two strokes run 0.1 mm apart.
const traced: TracedImage = {
  kind: 'traced-image',
  id: 'trace-1',
  source: 'sketch.png',
  traceMode: 'centerline',
  bounds: { minX: 10, minY: 10, maxX: 40, maxY: 10.1 },
  transform: IDENTITY_TRANSFORM,
  paths: [{ color: '#ff0000', polylines: [line(10), line(10.1)] }],
};

function projectWith(mode: LayerMode): Project {
  return {
    ...createProject(HEADLESS_DEVICE),
    scene: {
      ...EMPTY_SCENE,
      objects: [traced],
      layers: [{ ...createLayer({ id: 'red', color: '#ff0000' }), name: 'Trace', mode }],
    },
  };
}

describe('traceMinFeatureNotice', () => {
  it('warns when a traced cut has strokes closer than the kerf', () => {
    const notice = traceMinFeatureNotice(projectWith('line'), 'trace-1');
    expect(notice).toBe(
      'The trace on "Trace" has 1 gap narrower than the 0.15 mm kerf (narrowest 0.1 mm) — it ' +
        'will burn away or merge when cut. Job Review lists where; enlarge or simplify the ' +
        'trace to keep them.',
    );
  });

  it('stays quiet for an engraved (Fill) trace', () => {
    expect(traceMinFeatureNotice(projectWith('fill'), 'trace-1')).toBeNull();
  });

  it('runs after the commit and skips a trace that is gone', () => {
    const tasks: Array<() => void> = [];
    const pushWarning = vi.fn();
    const schedule = (task: () => void): void => {
      tasks.push(task);
    };
    scheduleTraceMinFeatureNotice('trace-1', () => projectWith('line'), pushWarning, schedule);
    expect(pushWarning).not.toHaveBeenCalled();
    tasks.shift()?.();
    expect(pushWarning).toHaveBeenCalledTimes(1);

    const empty = { ...projectWith('line'), scene: EMPTY_SCENE };
    scheduleTraceMinFeatureNotice('trace-1', () => empty, pushWarning, schedule);
    tasks.shift()?.();
    expect(pushWarning).toHaveBeenCalledTimes(1);
  });
});
