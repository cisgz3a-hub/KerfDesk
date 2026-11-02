import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextStyleFields } from './TextStyleFields';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

// The Right-to-left checkbox and the words beside it.
function rightToLeft(element: JSX.Element): {
  readonly box: HTMLInputElement;
  readonly label: string;
} {
  host = document.createElement('div');
  document.body.append(host);
  const mounted = createRoot(host);
  root = mounted;
  act(() => mounted.render(element));
  const label = [...host.querySelectorAll('label')].find((item) =>
    item.textContent?.startsWith('Right-to-left'),
  );
  const box = label?.querySelector('input');
  if (label === undefined || box === null || box === undefined)
    throw new Error('no Right-to-left checkbox');
  return { box, label: label.textContent ?? '' };
}

// Rolling audit v9 R4-P2-4 (ADR-591 Amendment 3).
describe('TextStyleFields Right-to-left', () => {
  it('says plainly a single-line font cannot do it, and cannot be turned on', () => {
    const { box, label } = rightToLeft(
      <TextStyleFields style={undefined} setStyle={vi.fn()} singleLineFont />,
    );
    expect(label).toBe('Right-to-left (not on single-line fonts)');
    expect(box.disabled).toBe(true);
    expect(box.title).toContain('burn left to right');
  });

  it('keeps the choice for when the font changes back', () => {
    const { box } = rightToLeft(
      <TextStyleFields style={{ forceRtl: true }} setStyle={vi.fn()} singleLineFont />,
    );
    expect(box.checked).toBe(true);
  });

  it('stays a plain option on an outline font', () => {
    const { box, label } = rightToLeft(<TextStyleFields style={undefined} setStyle={vi.fn()} />);
    expect(label).toBe('Right-to-left');
    expect(box.disabled).toBe(false);
  });
});
