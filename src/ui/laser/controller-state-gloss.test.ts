import { describe, expect, it } from 'vitest';
import { controllerStateGloss } from './controller-state-gloss';

// UX audit U4-P3-1: Pause showed "State: Door:0" with no word that the laser
// is off or that nothing opened.
describe('controllerStateGloss', () => {
  it('reads a ready Door hold as a pause with the laser off', () => {
    expect(controllerStateGloss('Door', 0, 'laser')).toBe('paused, laser off, ready to resume');
  });

  it('says spindle for a CNC', () => {
    expect(controllerStateGloss('Door', 0, 'cnc')).toBe('paused, spindle off, ready to resume');
  });

  it('names an open door input only when the controller reports one', () => {
    expect(controllerStateGloss('Door', 1, 'laser')).toContain('still open');
  });

  it('adds nothing to ordinary states', () => {
    expect(controllerStateGloss('Idle', null, 'laser')).toBeNull();
    expect(controllerStateGloss('Run', null, 'laser')).toBeNull();
  });
});
