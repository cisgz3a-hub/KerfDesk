import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PANEL_PULSE_ANIMATION, syncPanelPulse } from './sync-panel-pulses';

type FakeAnimation = { animationName?: string; startTime: number | null };

// Only a subtree lookup returns the ::before glow's animation, so the fake
// hands its animations back only when asked for the subtree.
function hintWith(animations: FakeAnimation[]): HTMLButtonElement {
  const button = document.createElement('button');
  Object.defineProperty(button, 'getAnimations', {
    value: (options?: GetAnimationsOptions) => (options?.subtree === true ? animations : []),
  });
  return button;
}

function animationStart(target: Element, animationName: string): AnimationEvent {
  const event = new Event('animationstart') as AnimationEvent;
  Object.defineProperty(event, 'animationName', { value: animationName });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

describe('syncPanelPulse', () => {
  it('pins every panel hint pulse, glow layer included, to the document timeline origin', () => {
    const pulse: FakeAnimation = { animationName: PANEL_PULSE_ANIMATION, startTime: 1734.5 };
    const other: FakeAnimation = { animationName: 'lf-attention-pulse', startTime: 900 };
    const transition: FakeAnimation = { startTime: 50 };
    syncPanelPulse(animationStart(hintWith([pulse, other, transition]), PANEL_PULSE_ANIMATION));
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

  function keyframesBody(): string {
    const start = css.indexOf(`@keyframes ${PANEL_PULSE_ANIMATION}`);
    let depth = 0;
    for (let index = css.indexOf('{', start); index < css.length; index += 1) {
      if (css[index] === '{') depth += 1;
      if (css[index] === '}') depth -= 1;
      if (depth === 0) return css.slice(start, index + 1);
    }
    return '';
  }

  it('names the keyframes the sync listens for', () => {
    expect(css).toContain(`@keyframes ${PANEL_PULSE_ANIMATION}`);
  });

  it('stays a faint tint and never fills the rail with the solid accent', () => {
    expect(css).not.toMatch(/background:\s*var\(--lf-accent\)\s*;/);
  });

  it('breathes by fading the glow alone, so the border and label never flash', () => {
    const properties = [...keyframesBody().matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]);
    expect(properties.length).toBeGreaterThan(0);
    expect(new Set(properties)).toEqual(new Set(['opacity']));
  });
});
