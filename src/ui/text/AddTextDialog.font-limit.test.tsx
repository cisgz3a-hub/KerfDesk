// Audit 13-P2-2 (regression): a font Import reuses a face already embedded,
// and a face past the project limit is refused when it is chosen, not at Save
// (ADR-628 Amendment 1).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreText from '../../core/text';
import { IDENTITY_TRANSFORM, type EmbeddedFont, type TextObject } from '../../core/scene';

const textMocks = vi.hoisted(() => ({
  textToPolylines: vi.fn(async (input: { readonly color: string }) => ({
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    paths: [
      {
        color: input.color,
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 5 },
            ],
          },
        ],
      },
    ],
  })),
}));

vi.mock('./font-loader', () => ({
  cssFamilyForFont: (key: string) => `lf2-${key}`,
  ensureFontCss: vi.fn(async () => undefined),
  loadFont: vi.fn(async () => new ArrayBuffer(8)),
}));
vi.mock('../../core/text', async (importOriginal) => {
  const actual = await importOriginal<typeof CoreText>();
  return { ...actual, textToPolylines: textMocks.textToPolylines };
});

import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { AddTextDialog } from './AddTextDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function faceBytes(face: number): Uint8Array {
  return new Uint8Array([79, 84, 84, 79, 0, 1, 2, face]);
}

function embedded(face: number): EmbeddedFont {
  return {
    key: `embedded:face-${face}`,
    fileName: `Face${face}.otf`,
    dataBase64: btoa(String.fromCharCode(...faceBytes(face))),
  };
}

function textUsing(font: EmbeddedFont, index: number): TextObject {
  return {
    kind: 'text',
    id: `sign-${index}`,
    content: 'Sign',
    fontKey: font.key,
    sizeMm: 12,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
  };
}

function seedFonts(count: number): ReadonlyArray<EmbeddedFont> {
  const fonts = Array.from({ length: count }, (_, index) => embedded(index + 1));
  fonts.forEach((font, index) =>
    useStore.getState().upsertTextObject(textUsing(font, index), font),
  );
  return fonts;
}

async function addTextWithImportedFont(face: number): Promise<void> {
  useUiStore.setState({ textDialog: { mode: 'add' } });
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  try {
    await act(async () => {
      root = createRoot(host);
      root.render(<AddTextDialog />);
    });
    await act(async () => {
      const textarea = host.querySelector('textarea');
      if (textarea === null) throw new Error('Text area not rendered');
      textarea.value = 'New sign';
      Simulate.change(textarea);
    });
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Import font file"]');
    if (input === null) throw new Error('Import font input not rendered');
    const bytes = faceBytes(face);
    const file = { name: `Face${face}.otf`, arrayBuffer: async () => bytes.buffer } as File;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => {
      Simulate.change(input);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      host
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
  } finally {
    await act(async () => root?.unmount());
    host.remove();
  }
}

beforeEach(() => {
  useStore.getState().newProject();
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  useStore.getState().newProject();
  useUiStore.setState({ textDialog: null });
});

describe('AddTextDialog embedded font choice', () => {
  it('uses the embedded font when the same face is imported again', async () => {
    const [first] = seedFonts(1);

    await addTextWithImportedFont(1);

    expect(useStore.getState().project.embeddedFonts).toEqual([first]);
    const added = useStore.getState().project.scene.objects.at(-1);
    expect(added).toMatchObject({ kind: 'text', content: 'New sign', fontKey: first?.key });
  });

  it('refuses a 33rd face when it is chosen, before it is embedded', async () => {
    const seeded = seedFonts(32);

    await addTextWithImportedFont(33);

    // The Import button's own error, so the choice was refused, not the commit.
    expect(useToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({
        message: expect.stringMatching(/already uses 32 embedded fonts/),
        variant: 'error',
      }),
    );
    expect(useStore.getState().project.embeddedFonts).toEqual(seeded);
  });
});
