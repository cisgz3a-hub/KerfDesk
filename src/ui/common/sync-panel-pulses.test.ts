import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PANEL_PULSE_ANIMATION, syncPanelPulse } from './sync-panel-pulses';

type FakeAnimation = { animationName?: string; startTime: number | null };

function hintWith(animations: FakeAnimation[]): HTMLButtonElement {
  const button = document.createElement('button');
  Object.defineProperty(button, 'getAnimations', { value: vi.fn(() => animations) });
  return button;
}

function animationStart(target: Element, animationName: string): AnimationEvent {
  const event = new Event('animationstart') as AnimationEvent;
  Object.defineProperty(event, 'animationName', { value: animationName });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

describe('syncPanelPulse', () => {
  it('includes pseudo-element crest and glow and pins both to the document timeline origin', () => {
    const pulse: FakeAnimation = { animationName: PANEL_PULSE_ANIMATION, startTime: 1734.5 };
    const glow: FakeAnimation = { animationName: PANEL_PULSE_ANIMATION, startTime: 1834.5 };
    const other: FakeAnimation = { animationName: 'lf-attention-pulse', startTime: 900 };
    const transition: FakeAnimation = { startTime: 50 };
    const hint = hintWith([pulse, glow, other, transition]);
    syncPanelPulse(animationStart(hint, PANEL_PULSE_ANIMATION));
    expect(hint.getAnimations).toHaveBeenCalledWith({ subtree: true });
    expect(glow.startTime).toBe(0);
    expect(pulse.startTime).toBe(0);
    expect(other.startTime).toBe(900);
    expect(transition.startTime).toBe(50);
  });

  it('ignores other animations and elements without the Web Animations API', () => {
    const pulse: FakeAnimation = { animationName: PANEL_PULSE_ANIMATION, startTime: 200 };
    syncPanelPulse(animationStart(hintWith([pulse]), 'lf-attention-pulse'));
    expect(pulse.startTime).toBe(200);
    expect(() =>
      syncPanelPulse(animationStart(document.createElement('div'), PANEL_PULSE_ANIMATION)),
    ).not.toThrow();
  });
});

describe('collapsed-panel hint style', () => {
  const css = readFileSync(
    join(process.cwd(), 'src', 'ui', 'common', 'collapsible-rail.css'),
    'utf8',
  );

  it('names the keyframes the sync listens for', () => {
    expect(css).toContain(`@keyframes ${PANEL_PULSE_ANIMATION}`);
  });

  it('stays a faint tint and never fills the rail with the solid accent', () => {
    const controlRule = css.match(/\.lf-btn\.lf-panel-expand-hint\s*\{([^}]*)\}/)?.[1];
    expect(controlRule).toBeDefined();
    expect(controlRule).not.toMatch(/background(?:-color)?:\s*var\(--lf-accent\)\s*;/);
  });
});
