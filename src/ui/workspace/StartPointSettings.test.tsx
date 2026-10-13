import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject, type Project } from '../../core/scene';
import { defaultCncMachiningSetup } from '../../core/scene/cnc-machining-setup';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { StartPointSettings } from './StartPointSettings';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  resetStore();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing ${label}`);
  return found;
}
async function show(project: Project): Promise<void> {
  useStore.setState({ project });
  await act(async () =>
    root.render(<StartPointSettings project={project} context={undefined} disabled={false} />),
  );
  await act(async () => button('Start points').click());
}
const settings = { frame: { edge: 1 as const, fraction: 0.5 }, job: { x: 25, y: 30 } };

describe('start point reset ownership', () => {
  it('keeps the source cutting start on Side B while allowing its frame reset', async () => {
    const project: Project = {
      ...createProject(),
      startPoints: settings,
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
    await show(project);
    expect(button('Automatic job start').disabled).toBe(true);
    await act(async () => button('Automatic job start').click());
    expect(useStore.getState().project.startPoints).toEqual(settings);
    await act(async () => button('Automatic frame start').click());
    expect(useStore.getState().project.startPoints).toEqual({ job: settings.job });
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
