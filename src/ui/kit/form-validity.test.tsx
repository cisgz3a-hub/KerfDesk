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
  it.each([
    ['223.85 in a 0.1 mm field from 0 (the Grid array total)', { min: 0, step: 0.1 }, '223.85'],
    ['304.8 in a 1 DPI field (12 lines/mm)', { min: 127, step: 1 }, '304.8'],
    ['1000.25 in a speed field with no step (which means 1)', { min: 1 }, '1000.25'],
  ])('submits %s, which the browser alone refuses', async (_label, props, value) => {
    const onSubmit = vi.fn();
    await renderForm(<NumberInput aria-label="Value" defaultValue={value} {...props} />, onSubmit);
    expect(input().validity.stepMismatch).toBe(true);
    expect(input().willValidate).toBe(true);
    await press();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it.each([
    ['below min', { defaultValue: '-1', min: 0, step: 0.1 }],
    ['above max', { defaultValue: '12', max: 10 }],
    ['empty and required', { defaultValue: '', required: true }],
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

// Forms that submit only values they have already clamped, so the browser has
// nothing to refuse: Adjust Image applies its normalized draft, Add Text clamps
// every field before rendering, and Convert to Bitmap's Convert button never
// ran the browser's check, so Enter submits the same way.
const CLAMPS_EVERY_VALUE = new Set([
  'src/ui/raster/AdjustImageDialog.tsx',
  'src/ui/text/AddTextDialog.tsx',
  'src/ui/raster/ConvertToBitmapDialog.tsx',
]);

// The sweep: every form in the app skips the browser's step check and submits
// through `checkedSubmit`, so no number field, whatever precision it shows or
// is typed into it, can silently block a command. No code asks a whole form
// for the browser's verdict either.
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

  it('opts out of the remaining checks only where every value is clamped', () => {
    const optedOut = sources
      .filter(([, text]) => /\bclampsEveryValue\b(?!\?:|\s*===)/.test(text))
      .map(([path]) => path)
      .filter((path) => path !== 'src/ui/kit/Dialog.tsx');
    expect(optedOut.every((path) => CLAMPS_EVERY_VALUE.has(path))).toBe(true);
    expect(optedOut).toContain('src/ui/raster/AdjustImageDialog.tsx');
  });

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
});

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
