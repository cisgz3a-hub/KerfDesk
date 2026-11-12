// The bit in the spindle (ADR-416 Amendment 4, annoyance audit A2 B4-P1-1):
// session state that a bit-change hold and the Machine rail declare, with the
// open project's Default bit standing in until either has.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../core/scene';
import { useLaserStore } from './laser-store';
import { initialLaserState, toolChangeContinueBlockMessage } from './laser-store-helpers';
import {
  declaredSpindleBit,
  holdEntrySpindleBitPatch,
  pendingSpindleBit,
  spindleBitChoices,
  spindleBitId,
  spindleBitOf,
  spindleBitTool,
} from './spindle-bit';
import { declareSpindleBit } from './spindle-bit-actions';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { toolChangeHoldEntryPatch } from './tool-change-hold-entry';

const DEFAULT_BIT = DEFAULT_CNC_MACHINE_CONFIG.toolId;
const OTHER_BIT = 'em-6350';
const OTHER_NAME = '6.35 mm (1/4") end mill';

const cncProject: Project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
const laserProject: Project = createProject();

beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  useStore.setState({ project: cncProject });
});

afterEach(() => {
  useLaserStore.setState(initialLaserState());
  resetStore();
});

describe('which bit Zero Z and the probe record Work Z for', () => {
  it("is the open CNC project's Default bit until a bit is declared", () => {
    expect(spindleBitId({}, cncProject)).toBe(DEFAULT_BIT);
    expect(spindleBitId({ spindleBit: null }, cncProject)).toBe(DEFAULT_BIT);
    expect(spindleBitOf({}, cncProject)?.toolId).toBe(DEFAULT_BIT);
    expect(spindleBitTool({}, cncProject)?.id).toBe(DEFAULT_BIT);
  });

  it('is the declared bit once one is, whatever the Default bit says', () => {
    const state = { spindleBit: { toolId: OTHER_BIT, name: 'a stale name' } };
    expect(spindleBitId(state, cncProject)).toBe(OTHER_BIT);
    // The open project's own name for the bit is the one shown.
    expect(spindleBitOf(state, cncProject)).toEqual({ toolId: OTHER_BIT, name: OTHER_NAME });
    expect(spindleBitTool(state, cncProject)?.diameterMm).toBe(6.35);
  });

  it('is unknown with a Laser project open and nothing declared', () => {
    expect(spindleBitId({}, laserProject)).toBeUndefined();
    expect(spindleBitOf({}, laserProject)).toBeNull();
    expect(spindleBitTool({}, laserProject)).toBeNull();
  });

  it('keeps a declared bit the open project does not list, by its own name', () => {
    const state = { spindleBit: { toolId: 'shop-bit', name: 'Shop compression bit' } };
    expect(spindleBitId(state, laserProject)).toBe('shop-bit');
    expect(spindleBitOf(state, cncProject)).toEqual(state.spindleBit);
    // Nothing is known about it but its name, so a corner probe cannot size it.
    expect(spindleBitTool(state, cncProject)).toBeNull();
    expect(spindleBitChoices(state, cncProject).at(-1)).toEqual(state.spindleBit);
  });
});

describe('a bit-change hold declares the bit it asked for', () => {
  it('names the pending bit as the bit in the spindle at hold entry', () => {
    const patch = toolChangeHoldEntryPatch({
      workZReferenceEpoch: 4,
      toolChangeLabels: [OTHER_NAME, 'third'],
      toolChangeToolIds: [OTHER_BIT, 'em-9525'],
    });
    expect(patch.pendingToolId).toBe(OTHER_BIT);
    expect(patch.spindleBit).toEqual({ toolId: OTHER_BIT, name: OTHER_NAME });
    // The hold still voids the previous bit's Work Z.
    expect(patch.workZZeroEvidence).toBeNull();
    expect(patch.workZReferenceEpoch).toBe(5);
  });

  it('leaves the declaration alone when the program names no bit', () => {
    const patch = toolChangeHoldEntryPatch({
      workZReferenceEpoch: 0,
      toolChangeLabels: ['a label only'],
      toolChangeToolIds: [null],
    });
    expect(patch.pendingToolId).toBeNull();
    expect('spindleBit' in patch).toBe(false);
    expect(holdEntrySpindleBitPatch({ pendingToolId: null, pendingToolLabel: 'x' })).toEqual({});
  });

  it('offers a pending bit the open project does not list', () => {
    const hold = { pendingToolId: 'job-bit', pendingToolLabel: 'Job-only bit' };
    expect(pendingSpindleBit(hold)).toEqual({ toolId: 'job-bit', name: 'Job-only bit' });
    expect(spindleBitChoices(hold, laserProject)).toEqual([
      { toolId: 'job-bit', name: 'Job-only bit' },
    ]);
    expect(declaredSpindleBit(hold, laserProject, 'job-bit')?.name).toBe('Job-only bit');
  });
});

describe('declaring the bit in the Machine rail', () => {
  it('sets the session bit and leaves the project as it was', () => {
    const project = useStore.getState().project;
    expect(declareSpindleBit(OTHER_BIT)).toBe(true);
    expect(useLaserStore.getState().spindleBit).toEqual({ toolId: OTHER_BIT, name: OTHER_NAME });
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useLaserStore.getState().log.at(-1)).toContain(OTHER_NAME);
  });

  it('refuses a bit nobody offered', () => {
    expect(declareSpindleBit('not-a-bit')).toBe(false);
    expect(useLaserStore.getState().spindleBit).toBeNull();
  });

  it('does not make a Work Z taken with another bit pass Continue', () => {
    // Work Z was taken while the Default bit was declared; the hold wants the other.
    const held = {
      ...useLaserStore.getState(),
      streamer: { status: 'tool-change', inFlight: [] },
      toolChangeIdleSeen: true,
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
      pendingToolId: OTHER_BIT,
      pendingToolLabel: OTHER_NAME,
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 0, toolId: DEFAULT_BIT },
    } as unknown as ReturnType<typeof useLaserStore.getState>;
    const blocked = toolChangeContinueBlockMessage(held);
    expect(blocked).toContain('Work Z belongs to a different bit');
    expect(blocked).toContain(`Load ${OTHER_NAME}, choose it under Bit in the spindle`);
    // Declaring the right bit afterwards changes nothing: the record keeps its bit.
    expect(toolChangeContinueBlockMessage({ ...held, spindleBit: pendingSpindleBit(held) })).toBe(
      blocked,
    );
    expect(
      toolChangeContinueBlockMessage({
        ...held,
        workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 0, toolId: OTHER_BIT },
      }),
    ).toBeNull();
  });
});
