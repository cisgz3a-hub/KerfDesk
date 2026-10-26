import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { groupSystemFonts, type SystemFontFace, type SystemFontQuery } from './system-fonts';
import {
  SYSTEM_FONT_RESTRICTED,
  SYSTEM_FONTS_DENIED,
  SYSTEM_FONTS_EMPTY,
  SYSTEM_FONTS_UNSUPPORTED,
  SystemFontsDialog,
} from './SystemFontsDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const roboto = new Uint8Array(readFileSync(resolve(__dirname, 'fonts/Roboto-Regular.ttf')));
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

function face(family: string, style: string, bytes: Uint8Array = roboto): SystemFontFace {
  const fullName = `${family} ${style}`;
  return {
    family,
    style,
    fullName,
    postscriptName: fullName.replace(/\s+/g, '-'),
    // jsdom's Blob cannot read its bytes; the browser's FontData blob can.
    blob: () => Promise.resolve({ arrayBuffer: async () => bytes.slice().buffer } as Blob),
  };
}

async function show(
  query: SystemFontQuery,
  importFont: (file: File) => Promise<void> = vi.fn(async () => undefined),
  onClose: () => void = vi.fn(),
): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <SystemFontsDialog
        query={Promise.resolve(query)}
        importFont={importFont}
        onClose={onClose}
      />,
    ),
  );
  return document.body;
}

function button(body: HTMLElement, label: string): HTMLButtonElement {
  const found = [...body.querySelectorAll('button')].find(
    (candidate) =>
      candidate.getAttribute('aria-label') === label || candidate.textContent === label,
  );
  if (found === undefined) throw new Error(`Button ${label} missing`);
  return found;
}

it('explains a browser without the API and a refused permission', async () => {
  expect((await show({ kind: 'unsupported' })).textContent).toContain(SYSTEM_FONTS_UNSUPPORTED);
  act(() => root?.unmount());
  expect((await show({ kind: 'denied' })).textContent).toContain(SYSTEM_FONTS_DENIED);
});

it('does not read an empty answer as no fonts installed', async () => {
  const body = await show({ kind: 'ok', families: [] });
  expect(body.textContent).toContain(SYSTEM_FONTS_EMPTY);
  expect(body.querySelector('input[type="search"]')).toBeNull();
});

it('lists families, narrows them by search and embeds the chosen face', async () => {
  const importFont = vi.fn(async (_file: File) => undefined);
  const onClose = vi.fn();
  const families = groupSystemFonts([face('Open Sans', 'Regular'), face('Courier New', 'Bold')]);
  const body = await show({ kind: 'ok', families }, importFont, onClose);
  expect(body.textContent).toContain('2 font families');
  const search = body.querySelector('input[type="search"]');
  if (!(search instanceof HTMLInputElement)) throw new Error('Search missing');
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setValue?.call(search, 'courier');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(body.textContent).toContain('1 font family');
  expect(body.textContent).not.toContain('Open Sans');
  await act(async () => button(body, 'Use Courier New Bold').click());
  expect(importFont).toHaveBeenCalledTimes(1);
  expect(importFont.mock.calls[0]?.[0].name).toBe('Courier New Bold.ttf');
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('says a restricted font limits embedding and embeds only when asked', async () => {
  const importFont = vi.fn(async (_file: File) => undefined);
  const restricted = withRestrictedFsType(roboto);
  const families = groupSystemFonts([face('Licensed', 'Regular', restricted)]);
  const body = await show({ kind: 'ok', families }, importFont);
  await act(async () => button(body, 'Use Licensed Regular').click());
  expect(body.textContent).toContain(SYSTEM_FONT_RESTRICTED);
  expect(importFont).not.toHaveBeenCalled();
  await act(async () => button(body, 'Embed font').click());
  expect(importFont).toHaveBeenCalledTimes(1);
});

it('shows why embedding failed and stays open', async () => {
  const onClose = vi.fn();
  const importFont = vi.fn(async () => {
    throw new Error('Font exceeds the 10485760-byte project limit.');
  });
  const families = groupSystemFonts([face('Huge', 'Regular')]);
  const body = await show({ kind: 'ok', families }, importFont, onClose);
  await act(async () => button(body, 'Use Huge Regular').click());
  expect(body.querySelector('[role="alert"]')?.textContent).toContain('project limit');
  expect(onClose).not.toHaveBeenCalled();
});

it('never embeds a face that finished reading after the dialog closed', async () => {
  const importFont = vi.fn(async (_file: File) => undefined);
  const onClose = vi.fn();
  let finishRead: (blob: Blob) => void = () => undefined;
  const slow: SystemFontFace = {
    ...face('Slow', 'Regular'),
    blob: () =>
      new Promise<Blob>((resolve) => {
        finishRead = resolve;
      }),
  };
  const body = await show({ kind: 'ok', families: groupSystemFonts([slow]) }, importFont, onClose);
  await act(async () => button(body, 'Use Slow Regular').click());
  await act(async () => button(body, 'Close').click());
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => finishRead({ arrayBuffer: async () => roboto.slice().buffer } as Blob));
  expect(importFont).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledTimes(1);
});

function withRestrictedFsType(font: Uint8Array): Uint8Array {
  const copy = font.slice();
  const data = new DataView(copy.buffer);
  const tables = data.getUint16(4);
  for (let index = 0; index < tables; index++) {
    const at = 12 + index * 16;
    if (data.getUint32(at) === 0x4f532f32) data.setUint16(data.getUint32(at + 8) + 8, 0x0002);
  }
  return copy;
}
