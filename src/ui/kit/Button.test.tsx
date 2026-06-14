import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Field } from './Field';
import { IconButton } from './IconButton';
import { NumberInput } from './NumberInput';
import { PanelHeading } from './PanelHeading';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(node: JSX.Element): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(node);
  });
  return host;
}

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe('kit Button', () => {
  it('defaults to type="button" so it never submits a form by accident', async () => {
    const h = await render(<Button onClick={() => undefined}>Go</Button>);
    expect(h.querySelector('button')?.getAttribute('type')).toBe('button');
  });

  it('maps variants to the tokens.css classes', async () => {
    const h = await render(
      <>
        <Button>a</Button>
        <Button variant="primary">b</Button>
        <Button variant="danger">c</Button>
        <Button variant="ghost">d</Button>
      </>,
    );
    const classes = [...h.querySelectorAll('button')].map((b) => b.className);
    expect(classes).toEqual([
      'lf-btn',
      'lf-btn lf-btn--primary',
      'lf-btn lf-btn--danger',
      'lf-btn lf-btn--ghost',
    ]);
  });

  it('renders aria-pressed only for toggle buttons', async () => {
    const h = await render(
      <>
        <Button pressed={true}>on</Button>
        <Button>plain</Button>
      </>,
    );
    const [toggle, plain] = [...h.querySelectorAll('button')];
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    expect(plain?.hasAttribute('aria-pressed')).toBe(false);
  });

  it('uses text children as the default hover explanation', async () => {
    const h = await render(
      <>
        <Button>Cancel</Button>
        <Button title="Keep this custom explanation">Save</Button>
      </>,
    );
    const [cancel, save] = [...h.querySelectorAll('button')];
    expect(cancel?.getAttribute('title')).toBe('Cancel');
    expect(save?.getAttribute('title')).toBe('Keep this custom explanation');
  });
});

describe('kit IconButton', () => {
  it('requires a label and uses it for aria-label and title', async () => {
    const onClick = vi.fn();
    const h = await render(<IconButton icon="plus" label="Zoom in" onClick={onClick} />);
    const button = h.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Zoom in');
    expect(button?.getAttribute('title')).toBe('Zoom in');
    expect(button?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('kit Field + NumberInput', () => {
  it('renders label, control, and unit; forwards the debounce contract untouched', async () => {
    const onChange = vi.fn();
    const h = await render(
      <Field label="Speed" unit="mm/min">
        <NumberInput defaultValue="1500" onChange={onChange} aria-label="Speed input" />
      </Field>,
    );
    expect(h.textContent).toContain('Speed');
    expect(h.textContent).toContain('mm/min');
    const input = h.querySelector('input');
    expect(input?.getAttribute('type')).toBe('number');
    expect(input?.className).toBe('lf-input');
    expect(input?.value).toBe('1500');
    await act(async () => {
      // React tracks input values internally; only the native prototype
      // setter makes a programmatic change visible to its onChange.
      const setValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      if (input !== null) setValue?.call(input, '1600');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
  });
});

describe('kit PanelHeading', () => {
  it('renders h2 by default and h3 for subsections', async () => {
    const h = await render(
      <>
        <PanelHeading>Layers</PanelHeading>
        <PanelHeading level={3}>Fill density</PanelHeading>
      </>,
    );
    expect(h.querySelector('h2.lf-heading')?.textContent).toBe('Layers');
    expect(h.querySelector('h3.lf-subheading')?.textContent).toBe('Fill density');
  });
});
