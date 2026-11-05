// Accessibility and small screens (UX audit U7-P3-1, U7-P3-2, U7-P3-5,
// U7-P3-7, U7-P3-9, U7-P3-10).
import { readFileSync } from 'node:fs';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { TOOL_HELP } from '../help/help-topics';
import { warnHintStyle } from '../laser/job-review/job-review.styles';
import { LIVE_MOTION_INSET_PROPERTY, useLiveMotionInset } from '../laser/use-live-motion-inset';
import { useFocusThroughDisable } from './use-focus-through-disable';
import { OVERFLOW_CUE_ATTRIBUTE, useScrollOverflowCue } from './use-scroll-overflow-cue';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function render(element: JSX.Element): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(element));
  return host;
}

function FrameButton(props: { readonly disabled: boolean }): JSX.Element {
  const ref = useFocusThroughDisable<HTMLButtonElement>(props.disabled);
  return (
    <section aria-label="Job actions">
      <button ref={ref} type="button" disabled={props.disabled}>
        Frame job
      </button>
    </section>
  );
}

describe('focus stays near a button that turns itself off (U7-P3-1)', () => {
  it('waits on the labelled group, then returns to the button', () => {
    const view = render(<FrameButton disabled={false} />);
    const button = view.querySelector('button') as HTMLButtonElement;
    const group = view.querySelector('section') as HTMLElement;
    button.focus();
    act(() => root?.render(<FrameButton disabled={true} />));
    expect(document.activeElement).toBe(group);
    expect(group.getAttribute('tabindex')).toBe('-1');
    act(() => root?.render(<FrameButton disabled={false} />));
    expect(document.activeElement).toBe(button);
    expect(group.hasAttribute('tabindex')).toBe(false);
  });

  it('leaves focus alone when the button was not focused', () => {
    const view = render(<FrameButton disabled={false} />);
    act(() => root?.render(<FrameButton disabled={true} />));
    expect(document.activeElement).not.toBe(view.querySelector('section'));
  });
});

function Bar(props: { readonly shown: boolean }): JSX.Element {
  const ref = useRef<HTMLElement>(null);
  useLiveMotionInset(ref, props.shown);
  return <section ref={ref}>Live Motion</section>;
}

describe('dialogs stay above the Live Motion bar (U7-P3-2)', () => {
  it('publishes the inset while the bar shows and removes it after', () => {
    const style = document.documentElement.style;
    render(<Bar shown={true} />);
    expect(style.getPropertyValue(LIVE_MOTION_INSET_PROPERTY)).toMatch(/^\d+(\.\d+)?px$/);
    act(() => root?.render(<Bar shown={false} />));
    expect(style.getPropertyValue(LIVE_MOTION_INSET_PROPERTY)).toBe('');
  });

  it('lifts the dialog backdrop and shortens the panel by that inset', () => {
    const css = readFileSync('src/ui/theme/tokens.css', 'utf8');
    expect(css).toContain('padding-bottom: var(--lf-live-motion-inset, 0px);');
    expect(css).toContain('max-height: calc(90vh - var(--lf-live-motion-inset, 0px));');
  });
});

function Strip(): JSX.Element {
  const ref = useScrollOverflowCue<HTMLDivElement>();
  return <div ref={ref}>Relative view — physical bed placement</div>;
}

describe('a clipped status line shows that it goes on (U7-P3-7)', () => {
  it('marks the strip while text runs past its right edge', () => {
    const scrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get: () => 900,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 400,
    });
    try {
      const strip = render(<Strip />).firstElementChild as HTMLElement;
      expect(strip.hasAttribute(OVERFLOW_CUE_ATTRIBUTE)).toBe(true);
      strip.scrollLeft = 500;
      act(() => {
        strip.dispatchEvent(new Event('scroll'));
      });
      expect(strip.hasAttribute(OVERFLOW_CUE_ATTRIBUTE)).toBe(false);
    } finally {
      if (scrollWidth) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidth);
      if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
    }
  });
});

describe('small text and labels', () => {
  it("draws the dark theme's disabled buttons dimmer, with a dashed border (U7-P3-5)", () => {
    const css = readFileSync('src/ui/theme/tokens.css', 'utf8');
    expect(css).toMatch(
      /:root\[data-theme='dark'\] \.lf-btn:disabled,\n:root\[data-theme='dark'\] \.lf-btn\[aria-disabled='true'\] \{\n {2}color: #7f786e;\n {2}border-style: dashed;/,
    );
  });

  it("keeps Job Review's warning hint at full colour (U7-P3-9)", () => {
    expect(warnHintStyle.opacity).toBeUndefined();
  });

  it('says how to add a shape by keyboard on every drawing tool (U7-P3-10)', () => {
    for (const tool of ['rect', 'ellipse', 'polygon', 'star', 'polyline'] as const) {
      expect(TOOL_HELP[tool].tooltip).toContain('by keyboard, add a shape from the design library');
    }
  });
});
