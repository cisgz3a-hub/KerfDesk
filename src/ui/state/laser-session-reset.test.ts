// Pins the session-scoped reset contract: every teardown path must drop the
// state that belonged to the dead controller session. Before this suite the
// teardown patches were hand-maintained field lists that had drifted — a stale
// ALARM survived Disconnect and kept the alarm banner mounted with no
// controller attached.
import { describe, expect, it } from 'vitest';
import { disconnectedStatePatch } from './laser-disconnected-state';
import { buildPortClosePatch, initialLaserState } from './laser-store-helpers';
import type { LaserState } from './laser-store';

// The patch builders read only scalar state fields, so a synthetic state is
// sufficient here and no action implementations are needed.
function dirtySessionState(): LaserState {
  return {
    ...initialLaserState(),
    alarmCode: 3,
    lastError: 24,
    activeWcs: 'G55',
    ovCache: { feed: 120, rapid: 100, spindle: 100 },
    activeJobMachineKind: 'cnc',
    toolChangeIdleSeen: true,
    toolChangeLabels: ['1/4in endmill'],
    toolChangeToolIds: ['tool-1'],
    pendingToolLabel: '1/8in ballnose',
    pendingToolId: 'tool-2',
  } as unknown as LaserState;
}

const teardownPaths = [
  { name: 'Disconnect', patch: disconnectedStatePatch },
  { name: 'port close', patch: buildPortClosePatch },
] as const;

describe.each(teardownPaths)('$name clears session-scoped controller state', ({ patch }) => {
  it('drops the controller fault codes', () => {
    const after = { ...dirtySessionState(), ...patch(dirtySessionState()) };
    expect(after.alarmCode).toBeNull();
    expect(after.lastError).toBeNull();
  });

  it('drops the cached modal and override readouts', () => {
    const after = { ...dirtySessionState(), ...patch(dirtySessionState()) };
    expect(after.activeWcs).toBeNull();
    expect(after.ovCache).toBeNull();
  });

  it('drops the finished job identity and its tool-change queue', () => {
    const after = { ...dirtySessionState(), ...patch(dirtySessionState()) };
    expect(after.activeJobMachineKind).toBeNull();
    expect(after.toolChangeIdleSeen).toBe(false);
    expect(after.toolChangeLabels).toEqual([]);
    expect(after.toolChangeToolIds).toEqual([]);
    expect(after.pendingToolLabel).toBeNull();
    expect(after.pendingToolId).toBeNull();
  });
});
