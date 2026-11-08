import { describe, expect, it } from 'vitest';
import type { CanvasMotionOverlay } from './draw-canvas-motion';
import { runStateLabel } from './canvas-motion-badge';

type Run = NonNullable<CanvasMotionOverlay['run']>;

function run(lifecycle: Run['lifecycle'], controllerState: string | null): Run {
  return { lifecycle, controllerState } as Run;
}

describe('runStateLabel', () => {
  // UX audit U4-P3-3: after Abort, a limit alarm or a pulled cable the badge
  // still read "Controller-reported • Run".
  it.each([
    ['stopped', 'Stopped'],
    ['disconnected', 'Disconnected'],
  ] as const)('names a %s run by its ending, not its last report', (lifecycle, label) => {
    expect(runStateLabel(run(lifecycle, 'Run'), 'laser')).toBe(label);
  });

  // UX audit U4-P3-1: Pause holds in the door state so the beam goes dark.
  it('reads a Door hold as a pause with the laser or spindle off', () => {
    expect(runStateLabel(run('paused', 'Door'), 'laser')).toBe('Paused, laser off');
    expect(runStateLabel(run('paused', 'Door'), 'cnc')).toBe('Paused, spindle off');
  });

  it('keeps the controller state while the run is live', () => {
    expect(runStateLabel(run('running', 'Run'), 'laser')).toBe('Run');
  });
});
