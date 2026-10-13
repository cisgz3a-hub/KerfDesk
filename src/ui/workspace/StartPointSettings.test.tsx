import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobBounds } from '../../core/job';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  type Project,
} from '../../core/scene';
import { defaultCncMachiningSetup } from '../../core/scene/cnc-machining-setup';
import { useStore } from '../state/store';
import { resetStore, svgObj } from '../state/test-helpers';
import { prepareOutput } from '../../io/gcode';
import { buildCanvasMarkerPlan } from '../state/canvas-motion-plan';
import { readStartPointDefaults, writeStartPointDefaults } from '../state/start-point-defaults';
import {
  selectCanvasStart,
  startEditReason,
  type StartEditingContext,
} from './canvas-start-editing';
import { StartPointSettings } from './StartPointSettings';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  resetStore();
  writeStartPointDefaults({});
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  writeStartPointDefaults({});
});
function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing ${label}`);
  return found;
}
async function show(project: Project, context?: StartEditingContext): Promise<void> {
  useStore.setState({ project });
  await act(async () =>
    root.render(<StartPointSettings project={project} context={context} disabled={false} />),
  );
  if (button('Start points').getAttribute('aria-expanded') === 'false')
    await act(async () => button('Start points').click());
}
const settings = { frame: { edge: 1 as const, fraction: 0.5 }, job: { x: 25, y: 30 } };

function sideBProject(): Project {
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    startPoints: settings,
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000' })],
      objects: [svgObj('line', ['#000000'])],
    },
    cncSetup: {
      ...defaultCncMachiningSetup(),
      twoSided: {
        activeSide: 'B',
        flipAxis: 'y',
        sideBStockOriginMm: { x: 0, y: 0 },
        sideAObjectIds: [],
        sideBObjectIds: [],
        registration: [],
      },
    },
  };
}

function editingContext(project: Project): StartEditingContext {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('Expected prepared project');
  return { sourceProject: project, prepared, registered: false };
}

describe('start point reset ownership', () => {
  it.each(['project', 'document', 'unmount'] as const)(
    'does not write delayed defaults after changing the %s owner',
    async (change) => {
      const project = { ...createProject(), startPoints: settings };
      let finish!: (bounds: JobBounds) => void;
      const waiting = new Promise<JobBounds>((resolve) => {
        finish = resolve;
      });
      const context = { ...editingContext(project), loadBounds: vi.fn(() => waiting) };
      await show(project, context);
      await act(async () => button('Use as defaults for new jobs').click());
      expect(button('Use as defaults for new jobs').disabled).toBe(true);
      expect(context.loadBounds).toHaveBeenCalledTimes(1);
      if (change === 'project') useStore.setState({ project: createProject() });
      if (change === 'document')
        useStore.setState({ projectDocumentEpoch: useStore.getState().projectDocumentEpoch + 1 });
      if (change === 'unmount') await act(async () => root.render(null));
      await act(async () => finish({ minX: 0, maxX: 100, minY: 0, maxY: 100 }));
      expect(readStartPointDefaults()).toBeUndefined();
      if (change !== 'unmount') expect(host.textContent).toContain('Defaults were not saved');
    },
  );

  it('reports a defaults preparation failure without replacing saved preferences', async () => {
    const project = { ...createProject(), startPoints: settings };
    writeStartPointDefaults({ frame: { edge: 3, fraction: 0.2 } });
    const context = {
      ...editingContext(project),
      loadBounds: async () => {
        throw new Error('worker failed');
      },
    };
    await show(project, context);
    await act(async () => button('Use as defaults for new jobs').click());
    expect(host.textContent).toContain('Could not prepare defaults');
    expect(readStartPointDefaults()).toEqual({ frame: { edge: 3, fraction: 0.2 } });
  });

  it('keeps the source cutting start on Side B while allowing its frame reset', async () => {
    const project = sideBProject();
    await show(project);
    expect(button('Automatic job start').disabled).toBe(true);
    await act(async () => button('Automatic job start').click());
    expect(useStore.getState().project.startPoints).toEqual(settings);
    await act(async () => button('Automatic frame start').click());
    expect(useStore.getState().project.startPoints).toEqual({ job: settings.job });
  });

  it('unlocks laser starts and defaults when the Side B CNC setup is parked', async () => {
    const cnc = sideBProject();
    await show(cnc, editingContext(cnc));
    expect(button('Use as defaults for new jobs').disabled).toBe(true);
    useStore.getState().setMachineKind('laser');
    const laser = useStore.getState().project;
    expect(laser.cncSetup?.twoSided?.activeSide).toBe('B');
    const context = editingContext(laser);
    expect(startEditReason('job', context)).toBeNull();
    const plan = buildCanvasMarkerPlan({
      prepared: context.prepared,
      relativeView: true,
      machine: { statusReport: null, alarmCode: null, hasActiveStreamer: false },
    });
    expect(selectCanvasStart('job', { x: 5, y: 5 }, plan, context)).not.toBeNull();
    await show(laser, context);
    expect(button('Automatic job start').disabled).toBe(false);
    expect(button('Use as defaults for new jobs').disabled).toBe(false);
    await act(async () => button('Use as defaults for new jobs').click());
    expect(readStartPointDefaults()?.job?.relative).toBe(true);
    await act(async () => button('Automatic job start').click());
    expect(useStore.getState().project.startPoints).toEqual({ frame: settings.frame });
    useStore.getState().setMachineKind('cnc');
    const resumed = useStore.getState().project;
    const resumedContext = editingContext(resumed);
    expect(startEditReason('job', resumedContext)).toMatch(/Side B/);
    expect(selectCanvasStart('job', { x: 5, y: 5 }, plan, resumedContext)).toBeNull();
    await show(resumed, resumedContext);
    expect(button('Use as defaults for new jobs').disabled).toBe(true);
  });
  it.each(['Automatic frame start', 'Automatic job start'])(
    'rejects stale enabled %s controls during an artwork transaction',
    async (label) => {
      await show({ ...createProject(), startPoints: settings });
      useStore.getState().beginInteraction();
      await act(async () => button(label).click());
      expect(useStore.getState().project.startPoints).toEqual(settings);
      expect(useStore.getState().undoStack).toHaveLength(0);
    },
  );
});
