import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  repairArtwork,
  repairLine,
  repairMetrics,
  repairRectangle,
} from '../../__fixtures__/vector-repair-fixtures';
import { createLayer, createProject, type ImportedSvg } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { VectorRepairDialogHost } from './VectorRepairDialogHost';
import { buildAppCommands, commandById, runCommand } from './command-registry';
import { baseCtx } from './command-registry-test-helpers';
import { selectionCanJoinPaths } from './selection-command-state';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  resetStore();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function load(objects: ImportedSvg[]) {
  const project = {
    ...createProject(),
    scene: {
      objects,
      layers: [
        createLayer({ id: 'cut', name: 'Cut outline', color: '#000000' }),
        createLayer({ id: 'other', name: 'Second cut', color: '#0000ff' }),
      ],
      groups: [],
    },
  };
  useStore.setState({
    project,
    selectedObjectId: objects[0]?.id ?? null,
    additionalSelectedIds: new Set(objects.slice(1).map((object) => object.id)),
    dirty: false,
  });
  return project;
}
function submit(): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button === null) throw new Error('Missing submit');
  return button;
}
async function setTolerance(value: string) {
  const input = host.querySelector('input');
  if (input === null) throw new Error('Missing tolerance');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('usable silhouette and path repair controls', () => {
  it('lets the operator choose the result operation and commits the actual silhouette', async () => {
    load([
      repairArtwork('a', [repairRectangle(40, 40, 60, 40)]),
      repairArtwork('b', [repairRectangle(70, 60, 60, 40)], { operationIds: ['other'] }),
    ]);
    const close = vi.fn();
    await act(async () => root.render(<VectorRepairDialogHost kind="union" onClose={close} />));
    expect(host.textContent).toContain('Result operation');
    const select = host.querySelector('select');
    if (select === null) throw new Error('Missing operation choice');
    await act(async () => {
      select.value = 'other';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => submit().click());
    const result = useStore.getState().project.scene.objects[0] as ImportedSvg;
    expect(result.operationIds).toEqual(['other']);
    expect(repairMetrics(result).length).toBe(300);
    expect(close).toHaveBeenCalledOnce();
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('shows updated counts as tolerance changes and joins across artwork when applied', async () => {
    load([
      repairArtwork('a', [repairLine({ x: 0, y: 0 }, { x: 10, y: 0 })]),
      repairArtwork('b', [repairLine({ x: 10.1, y: 0 }, { x: 20, y: 0 })]),
    ]);
    const close = vi.fn();
    await act(async () => root.render(<VectorRepairDialogHost kind="join" onClose={close} />));
    expect(submit().disabled).toBe(true);
    expect(host.textContent).toContain('0 joins and 0 closures');
    await setTolerance('0.2');
    expect(submit().disabled).toBe(false);
    expect(host.textContent).toContain('1 joins and 0 closures');
    await act(async () => submit().click());
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects blank/negative tolerance and explains mismatched operations without mutation', async () => {
    const before = load([
      repairArtwork('a', [repairLine({ x: 0, y: 0 }, { x: 10, y: 0 })]),
      repairArtwork('b', [repairLine({ x: 10, y: 0 }, { x: 20, y: 0 })], {
        operationIds: ['other'],
      }),
    ]);
    await act(async () => root.render(<VectorRepairDialogHost kind="join" onClose={vi.fn()} />));
    expect(host.textContent).toContain('same operation');
    expect(submit().disabled).toBe(true);
    await setTolerance('');
    expect(submit().disabled).toBe(true);
    await setTolerance('-1');
    expect(submit().disabled).toBe(true);
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('routes each new menu action and gates Join on a wholly unlocked open-vector selection', () => {
    const unionSilhouette = vi.fn();
    const joinPaths = vi.fn();
    const commands = buildAppCommands(
      baseCtx({ canWeldSelection: true, canJoinPaths: true, unionSilhouette, joinPaths }),
    );
    expect(runCommand(commandById(commands, 'tools.union-silhouette'))).toBe(true);
    expect(runCommand(commandById(commands, 'tools.join-paths'))).toBe(true);
    expect(unionSilhouette).toHaveBeenCalledOnce();
    expect(joinPaths).toHaveBeenCalledOnce();
    expect(runCommand(commandById(buildAppCommands(baseCtx()), 'tools.join-paths'))).toBe(false);
    const project = load([
      repairArtwork('a', [repairLine({ x: 0, y: 0 }, { x: 10, y: 0 })]),
      repairArtwork('locked', [repairLine({ x: 10, y: 0 }, { x: 20, y: 0 })], { locked: true }),
    ]);
    expect(selectionCanJoinPaths(project, ['a'])).toBe(true);
    expect(selectionCanJoinPaths(project, ['a', 'locked'])).toBe(false);
    expect(selectionCanJoinPaths(project, ['a', 'gone'])).toBe(false);
  });
});
