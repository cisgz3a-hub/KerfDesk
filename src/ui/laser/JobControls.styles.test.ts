import { describe, expect, it } from 'vitest';
import { rowStyle, runningSafetyStyle } from './JobControls.styles';

// Regression guard for the machine-rail button-clipping bug: the job-action rows
// live in a fixed-width side rail whose ancestors set overflow-x:hidden with no
// scrollbar, so a non-wrapping row pushes its rightmost buttons — Start job and
// the safety-critical Stop — off-screen and unreachable. Layout isn't computed in
// JSDOM, so this asserts the style contract that prevents the clip rather than a
// rendered width; the visible result is confirmed perceptually.
describe('JobControls rail styles', () => {
  it('lets the button rows wrap so Start/Stop cannot clip off the fixed-width rail', () => {
    expect(rowStyle.flexWrap).toBe('wrap');
    expect(rowStyle.minWidth).toBe(0);
  });

  it('drops the running safety text onto its own line so it never pushes Stop off-screen', () => {
    expect(runningSafetyStyle.flexBasis).toBe('100%');
  });
});
