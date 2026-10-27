// Rolling audit v4 H4-P1-1 and H9-P1-1 (ADR-500 Amendment 2, ADR-440
// Amendment 6): opening a file never puts its copy of the machine in place of
// the operator's own unannounced, and the app never remembers a machine the
// operator rejected or did not choose. Real store, real persistence hook,
// output from emitGcode.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { emitGcode } from '../../io/gcode';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from '../state';
import { loadLastMachine } from '../state/last-machine-persistence';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { undoStepName } from '../state/undo-step-names';
import { useMachineProfilePersistence } from './use-machine-profile-persistence';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CLAMP = { id: 'clamp', name: 'Clamp', enabled: true, x: 0, y: 0, width: 60, height: 60 };

let root: Root;
function Probe(): null {
  useMachineProfilePersistence();
  return null;
}

beforeEach(async () => {
  localStorage.clear();
  resetStore();
  useToastStore.setState({ toasts: [] });
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  localStorage.clear();
  resetStore();
  useToastStore.setState({ toasts: [] });
});

// A 1 mm line ending at canvas (20, 20).
function withLine(project: Project): Project {
  const color = '#ff0000';
  return {
    ...project,
    scene: {
      layers: [{ ...createLayer({ id: 'line', color }), power: 50 }],
      objects: [
        {
          kind: 'imported-svg',
          id: 'line-object',
          source: 'line.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 19, minY: 20, maxX: 20, maxY: 20 },
          paths: [
            {
              color,
              polylines: [
                {
                  points: [
                    { x: 19, y: 20 },
                    { x: 20, y: 20 },
                  ],
                  closed: false,
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function burn(project: Project): { readonly lines: string[]; readonly noGo: number } {
  const out = emitGcode(project);
  return {
    lines: out.gcode.split('\n').filter((line) => /^G1 X/.test(line)),
    noGo: out.preflight.issues.filter((issue) => issue.code === 'no-go-zone-collision').length,
  };
}

function reopen(text: string): void {
  const parsed = deserializeProject(text);
  if (parsed.kind !== 'ok') throw new Error(`parse ${parsed.kind}`);
  expect(useStore.getState().setProject(parsed.project).kind).toBe('loaded');
}

function toasts(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

describe('opening an older file for the same machine (H4-P1-1)', () => {
  it('keeps the corrected origin and no-go zone, says so, and remembers them', () => {
    useStore.getState().updateDeviceProfile({ origin: 'front-left', noGoZones: [] });
    const saved = serializeProject(withLine(createProject(useStore.getState().project.device)));
    // The operator then finds the machine is rear-left and adds a clamp zone.
    useStore.getState().updateDeviceProfile({ origin: 'rear-left', noGoZones: [CLAMP] });
    const before = burn(withLine(useStore.getState().project));
    expect(before.lines[0]).toMatch(/^G1 X20\.000 Y20\.000/);
    expect(before.noGo).toBeGreaterThan(0);

    reopen(saved);
    const state = useStore.getState();
    expect(state.projectBedReconciliation).toBeNull();
    expect(state.project.device.origin).toBe('rear-left');
    expect(state.project.device.noGoZones).toEqual([CLAMP]);
    expect(burn(state.project)).toEqual(before);
    expect(toasts()).toContainEqual(
      expect.stringContaining(
        "This file's machine settings were not used (origin and no-go zones)",
      ),
    );

    useStore.getState().updateDeviceProfile({ framingFeedMmPerMin: 1234 });
    expect(loadLastMachine(localStorage)).toMatchObject({
      origin: 'rear-left',
      noGoZones: [CLAMP],
      framingFeedMmPerMin: 1234,
    });
  });

  it('keeps the CNC head’s machine values but the file’s stock', () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().updateCncMachine({ stock: { thicknessMm: 29 } });
    const saved = serializeProject(useStore.getState().project);
    useStore.getState().updateCncMachine({ params: { safeZMm: 17 }, stock: { thicknessMm: 12 } });

    reopen(saved);
    const machine = useStore.getState().project.machine;
    if (machine?.kind !== 'cnc') throw new Error('Expected the CNC job');
    expect(machine.params.safeZMm).toBe(17);
    expect(machine.stock.thicknessMm).toBe(29);
    expect(toasts()).toContainEqual(expect.stringContaining('(CNC settings)'));
  });

  it('opens a file whose machine copy matches with no machine toast', () => {
    useStore.getState().updateDeviceProfile({ origin: 'rear-left' });
    const saved = serializeProject(withLine(createProject(useStore.getState().project.device)));
    reopen(saved);
    expect(useStore.getState().project.device.origin).toBe('rear-left');
    expect(toasts().filter((message) => message.includes('machine settings'))).toEqual([]);
  });
});

describe('Keep current machine is an Undo step (H9-P1-1)', () => {
  // The bed was corrected to 400 × 410 after the file was saved at 400 × 400.
  function openOlderBed(): string {
    useStore.getState().updateDeviceProfile({ origin: 'front-left' });
    const file = withLine(createProject(useStore.getState().project.device));
    useStore.getState().updateDeviceProfile({ bedHeight: 410 });
    reopen(serializeProject(file));
    expect(useStore.getState().projectBedReconciliation?.bedSizeOnly).toBe(true);
    expect(loadLastMachine(localStorage)?.bedHeight).toBe(410);
    return serializeProject(file);
  }

  function expectBed(height: number, notice: 'shown' | null): void {
    const state = useStore.getState();
    expect(state.project.device.bedHeight).toBe(height);
    expect(state.project.workspace.height).toBe(height);
    expect(state.projectBedReconciliation === null ? null : 'shown').toBe(notice);
    // Front-left origin: canvas y 20 is machine Y (bed height − 20).
    expect(burn(state.project).lines[0]).toMatch(new RegExp(`^G1 X20\\.000 Y${height - 20}\\.000`));
  }

  it('Undo of an older edit cannot reinstall the file’s bed unseen', () => {
    openOlderBed();
    useStore.getState().setProjectNotes('Sign for the shop door');
    useStore.getState().keepCurrentMachineForOpenedProject();
    expectBed(410, null);
    const { project, undoStack } = useStore.getState();
    expect(undoStepName(undoStack[undoStack.length - 1]!, project)).toBe('Keep current machine');

    // The first Undo is the Keep itself: the file's bed comes back with its notice.
    useStore.getState().undo();
    expectBed(400, 'shown');
    expect(useStore.getState().projectBedReconciliation?.bedSizeOnly).toBe(true);
    useStore.getState().undo();
    expectBed(400, 'shown');
    expect(loadLastMachine(localStorage)?.bedHeight).toBe(410);

    useStore.getState().redo();
    useStore.getState().redo();
    expectBed(410, null);
    expect(loadLastMachine(localStorage)?.bedHeight).toBe(410);
  });

  it('Keep clears the Redo list, so Redo cannot bring the file’s bed back', () => {
    openOlderBed();
    useStore.getState().setProjectNotes('Sign for the shop door');
    useStore.getState().undo();
    useStore.getState().keepCurrentMachineForOpenedProject();
    expect(useStore.getState().redoStack).toEqual([]);
    useStore.getState().redo();
    expectBed(410, null);
    expect(loadLastMachine(localStorage)?.bedHeight).toBe(410);
  });

  it('an edit to the file’s machine before any choice is not remembered', () => {
    openOlderBed();
    useStore.getState().updateDeviceProfile({ framingFeedMmPerMin: 2222 });
    expect(loadLastMachine(localStorage)).toMatchObject({ bedHeight: 410 });
    expect(loadLastMachine(localStorage)?.framingFeedMmPerMin).not.toBe(2222);
    useStore.getState().acceptOpenedProjectMachine();
    useStore.getState().updateDeviceProfile({ framingFeedMmPerMin: 3333 });
    expect(loadLastMachine(localStorage)).toMatchObject({
      bedHeight: 400,
      framingFeedMmPerMin: 3333,
    });
  });
});
