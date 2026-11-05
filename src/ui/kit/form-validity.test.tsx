import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';
import { NumberInput } from './NumberInput';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function renderForm(field: JSX.Element, onSubmit: () => void): Promise<void> {
  await act(async () =>
    root.render(
      <Dialog
        title="Form"
        as="form"
        onClose={() => undefined}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {field}
        <button type="submit">Go</button>
      </Dialog>,
    ),
  );
}

function input(): HTMLInputElement {
  return document.querySelector('input')!;
}

async function press(): Promise<void> {
  await act(async () =>
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(),
  );
}

describe('dialog form validity (performance audit S6-P2-2)', () => {
  it('submits a value between steps, which the browser alone refuses', async () => {
    const onSubmit = vi.fn();
    await renderForm(
      <NumberInput aria-label="Total" defaultValue="223.85" min={0} step={0.1} />,
      onSubmit,
    );
    expect(input().validity.stepMismatch).toBe(true);
    expect(input().willValidate).toBe(true);
    await press();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it.each([
    ['below min', { defaultValue: '-1', min: 0, step: 0.1 }],
    ['above max', { defaultValue: '12', max: 10 }],
    ['empty and required', { defaultValue: '', required: true }],
    ['with a fraction in a whole-number step', { defaultValue: '2.5', min: 1, step: 1 }],
    ['with a fraction and no step (which means 1)', { defaultValue: '2.5', min: 1 }],
  ])('refuses a value %s and reports it at its field', async (_label, props) => {
    const onSubmit = vi.fn();
    await renderForm(<NumberInput aria-label="Value" {...props} />, onSubmit);
    const reported = vi.spyOn(input(), 'reportValidity');
    await press();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(reported).toHaveBeenCalledOnce();
  });

  it('refuses a field with its own message', async () => {
    const onSubmit = vi.fn();
    await renderForm(<NumberInput aria-label="Value" defaultValue="3" />, onSubmit);
    input().setCustomValidity('Enter a whole number of passes.');
    await press();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

// The sweep: every form in the app skips the browser's step check and submits
// through `checkedSubmit`, so no decimal-step number field, whatever precision
// it shows or is typed into it, can silently block a command. No code asks a
// whole form for the browser's verdict either, and no whole-number field (which
// still refuses fractions) shows a value with decimals.
// Forms whose handler clamps every value, so the browser has nothing to refuse.
// Convert to Bitmap's Convert button never ran the browser's check; Enter
// submits the same way.
const CLAMPS_EVERY_VALUE = new Set(['src/ui/raster/ConvertToBitmapDialog.tsx']);

describe('every form submits without the browser step check', () => {
  const uiRoot = join(process.cwd(), 'src', 'ui');
  const sources = listSources(uiRoot);

  it('finds the app forms', () => {
    expect(sources.filter(([, text]) => /<form\b/.test(text)).length).toBeGreaterThanOrEqual(5);
  });

  it.each(sources.filter(([, text]) => /<form\b/.test(text)))(
    '%s sets noValidate and checkedSubmit on each form',
    (path, text) => {
      // Up to the first `>`, which may be an arrow's: enough to hold both props
      // when they come before the handler's body.
      for (const tag of text.match(/<form\b[^>]*>/g) ?? []) {
        expect(tag).toContain('noValidate');
        if (!CLAMPS_EVERY_VALUE.has(path)) expect(tag).toContain('checkedSubmit(');
      }
    },
  );

  it('no code checks a whole form with the browser', () => {
    const offenders = sources
      .filter(
        ([path, text]) =>
          !path.endsWith('form-validity.ts') &&
          /\bform\??\.(reportValidity|checkValidity)\(/.test(text),
      )
      .map(([path]) => path);
    expect(offenders).toStrictEqual([]);
  });

  it('no whole-number field shows decimals', () => {
    const fields = sources.flatMap(([path, text]) =>
      (text.match(/<(?:NumberInput|input)\b(?:[^/]|\/(?!>))*\/>/g) ?? [])
        .filter((tag) => tag.startsWith('<NumberInput') || /type=["{']*number/.test(tag))
        .map((tag) => [path, tag] as const),
    );
    expect(fields.length).toBeGreaterThan(50);
    expect(showsDecimalsInWholeStep('<NumberInput value={total.toFixed(2)} min={0} />')).toBe(true);
    expect(showsDecimalsInWholeStep('<input type="number" value={a.toFixed(1)} step="1" />')).toBe(
      true,
    );
    expect(showsDecimalsInWholeStep('<NumberInput value={t.toFixed(2)} step={0.1} />')).toBe(false);
    const offenders = fields
      .filter(([, tag]) => showsDecimalsInWholeStep(tag))
      .map(([path]) => path);
    expect(offenders).toStrictEqual([]);
  });
});

function showsDecimalsInWholeStep(tag: string): boolean {
  if (!/value=\{[^}]*\.toFixed\([1-9]\)/.test(tag)) return false;
  const step = /\bstep=(?:\{([\d.]+)\}|"([^"]*)")/.exec(tag);
  if (/\bstep=/.test(tag) && step === null) return false; // a computed step
  const literal = step?.[1] ?? step?.[2] ?? '';
  return literal === '' || Number.isInteger(Number(literal));
}

function listSources(directory: string): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...listSources(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.test(-support)?\.tsx?$|\.test\./.test(entry.name)) {
      // Comments mention `<form>` without being one.
      const code = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      found.push([relative(process.cwd(), path).replaceAll('\\', '/'), code]);
    }
  }
  return found;
}
